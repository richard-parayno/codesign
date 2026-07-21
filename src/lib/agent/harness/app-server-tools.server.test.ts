import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasSessionService } from './contracts';
import { CANVAS_APP_SERVER_TOOLS, CanvasAppServerToolDispatcher } from './app-server-tools.server';

function service(dispatch: CanvasSessionService['dispatch'] = vi.fn(async () => ({ ok: true }))) {
  return {
    createSession: vi.fn(),
    dispatch,
    cancelSession: vi.fn(),
    cleanupExpired: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CanvasSessionService;
}

describe('Canvas App Server tools', () => {
  it('exposes the complete bounded vocabulary as typed dynamic tools', () => {
    expect(CANVAS_APP_SERVER_TOOLS).toHaveLength(9);
    expect(CANVAS_APP_SERVER_TOOLS.map((tool) => ('name' in tool ? tool.name : ''))).toEqual([
      'scene_overview',
      'scene_get_nodes',
      'scene_render',
      'components_search',
      'components_describe',
      'candidate_get_state',
      'candidate_apply_changes',
      'candidate_validate',
      'candidate_submit',
    ]);
    const getNodes = CANVAS_APP_SERVER_TOOLS.find(
      (tool) => 'name' in tool && tool.name === 'scene_get_nodes',
    );
    expect(getNodes && 'inputSchema' in getNodes ? getNodes.inputSchema : null).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['nodeIds'],
    });
    const applyChanges = CANVAS_APP_SERVER_TOOLS.find(
      (tool) => 'name' in tool && tool.name === 'candidate_apply_changes',
    );
    const applySchema = JSON.stringify(
      applyChanges && 'inputSchema' in applyChanges ? applyChanges.inputSchema : null,
    );
    expect(applySchema.length).toBeLessThan(12_000);
    expect(applySchema).not.toContain('create-project-component');
    expect(applySchema).not.toContain('generalize');
    expect(applySchema).not.toContain('duplicate-screen');
    expect(applySchema).not.toContain('screenId');
    expect(applySchema).toContain('nodeId');
  });

  it('validates arguments and dispatches only the canonical service operation', async () => {
    const dispatch = vi.fn(async () => ({ nodes: [{ id: 'node-1' }] }));
    const activity: unknown[] = [];
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1', {
      onActivity: (event) => activity.push(event),
    });

    await expect(
      adapter.dispatch({
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-1',
        namespace: null,
        tool: 'scene_get_nodes',
        arguments: { nodeIds: ['node-1'], descendants: true },
      }),
    ).resolves.toEqual({
      success: true,
      contentItems: [
        { type: 'inputText', text: JSON.stringify({ result: { nodes: [{ id: 'node-1' }] } }) },
      ],
    });
    expect(dispatch).toHaveBeenCalledWith('session-1', 'scene.get_nodes', {
      nodeIds: ['node-1'],
      descendants: true,
    });
    expect(activity).toMatchObject([
      { phase: 'started', tool: 'scene.get_nodes' },
      { phase: 'completed', tool: 'scene.get_nodes' },
    ]);
  });

  it('returns repairable invalid-argument errors without reaching session logic', async () => {
    const dispatch = vi.fn();
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1');
    const response = await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: null,
      tool: 'scene_get_nodes',
      arguments: { nodeIds: [] },
    });

    expect(response.success).toBe(false);
    expect(
      JSON.parse(
        response.contentItems[0].type === 'inputText' ? response.contentItems[0].text : '',
      ),
    ).toMatchObject({
      error: { code: 'invalid-arguments', message: 'Invalid arguments for scene.get_nodes' },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('captures a successful candidate submission for the transport completion contract', async () => {
    const adapter = new CanvasAppServerToolDispatcher(
      service(vi.fn(async () => ({ candidateRevisionId: 'candidate-revision-2' }))),
      'session-1',
    );
    await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-submit',
      namespace: null,
      tool: 'candidate_submit',
      arguments: {},
    });
    expect(adapter.submittedResult).toEqual({
      tool: 'candidate.submit',
      result: { candidateRevisionId: 'candidate-revision-2' },
    });
  });

  it('normalizes nested create input into the compact server-owned wire operation', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1');

    await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-create',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [
          {
            operation: {
              type: 'create',
              node: {
                name: 'Created node',
                kind: 'rectangle',
                screenId: 'hallucinated-screen',
                parentId: 'frame-1',
                bounds: { x: 10, y: 20, width: 100, height: 80 },
                style: { fill: '#ffffff' },
              },
            },
            evidenceNodeIds: ['frame-1'],
            summary: 'Created a panel in the observed frame.',
          },
        ],
      },
    });

    expect(dispatch).toHaveBeenCalledWith(
      'session-1',
      'candidate.apply_changes',
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            operation: expect.objectContaining({
              type: 'create',
              name: 'Created node',
              kind: 'rectangle',
              parentId: 'frame-1',
              bounds: { x: 10, y: 20, width: 100, height: 80 },
              style: { fill: '#ffffff' },
            }),
          }),
        ],
      }),
    );
    const forwarded = (dispatch.mock.calls as unknown[][])[0][2] as {
      changes: Array<{ operation: Record<string, unknown> }>;
    };
    expect(forwarded.changes[0].operation).not.toHaveProperty('id');
    expect(forwarded.changes[0].operation).not.toHaveProperty('nodeId');
    expect(forwarded.changes[0].operation).not.toHaveProperty('screenId');
  });

  it('normalizes common target and patch aliases before validation', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1');

    await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-update-alias',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [
          {
            operation: {
              type: 'update-node',
              targetId: 'node-1',
              updates: { name: 'Updated name' },
            },
            evidenceNodeIds: ['node-1'],
            summary: 'Clarified the node name.',
          },
        ],
      },
    });

    expect(dispatch).toHaveBeenCalledWith(
      'session-1',
      'candidate.apply_changes',
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            operation: {
              type: 'update-node',
              targetIds: ['node-1'],
              patch: { name: 'Updated name' },
            },
          }),
        ],
      }),
    );
  });

  it('normalizes node-based style and absolute move aliases from agent retries', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1');

    await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-operation-aliases',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [
          {
            operation: {
              type: 'style',
              nodeId: 'node-1',
              style: { fill: '#ffffff' },
            },
            evidenceNodeIds: ['node-1'],
            summary: 'Styled the selected node.',
          },
          {
            operation: {
              type: 'move',
              nodeId: 'node-1',
              bounds: { x: 10, y: 20, width: 100, height: 80 },
            },
            evidenceNodeIds: ['node-1'],
            summary: 'Placed the selected node at exact bounds.',
          },
        ],
      },
    });

    expect(dispatch).toHaveBeenCalledWith(
      'session-1',
      'candidate.apply_changes',
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            operation: {
              type: 'style',
              targetIds: ['node-1'],
              patch: { fill: '#ffffff' },
            },
          }),
          expect.objectContaining({
            operation: {
              type: 'resize',
              targetId: 'node-1',
              bounds: { x: 10, y: 20, width: 100, height: 80 },
            },
          }),
        ],
      }),
    );
  });

  it('preserves the singular targetId required by resize operations', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1');

    const response = await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-resize',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [
          {
            operation: {
              type: 'resize',
              targetId: 'node-1',
              bounds: { x: 10, y: 20, width: 100, height: 80 },
            },
            evidenceNodeIds: ['node-1'],
            summary: 'Resized the selected node.',
          },
        ],
      },
    });

    expect(response.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      'session-1',
      'candidate.apply_changes',
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            operation: expect.objectContaining({ type: 'resize', targetId: 'node-1' }),
          }),
        ],
      }),
    );
  });

  it('publishes field-level diagnostics for invalid candidate changes', async () => {
    const activity: unknown[] = [];
    const dispatch = vi.fn();
    const adapter = new CanvasAppServerToolDispatcher(service(dispatch), 'session-1', {
      onActivity: (event) => activity.push(event),
    });

    const response = await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-invalid-apply',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [{ operation: { id: 'bad', type: 'style', targetIds: ['node-1'] } }],
      },
    });

    expect(response.success).toBe(false);
    expect(activity).toMatchObject([
      {
        phase: 'failed',
        error: 'Invalid arguments for candidate.apply_changes',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining('changes.0') }),
        ]),
      },
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises a fatal protocol error after repeated consecutive mutation failures', async () => {
    const onFatal = vi.fn();
    const adapter = new CanvasAppServerToolDispatcher(service(vi.fn()), 'session-1', {
      onFatal,
    });
    const invalidCall = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [{ operation: { type: 'style', targetIds: ['node-1'] } }],
      },
    };

    for (let index = 0; index < 6; index += 1)
      await adapter.dispatch({ ...invalidCall, callId: `call-invalid-${index}` });

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toMatchObject({
      name: 'CodexProtocolError',
      code: 'mutation-retry-limit',
      stage: 'candidate-mutation',
    });
  });

  it('attaches scene renders as image content without exposing local artifact paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codesign-render-tool-'));
    const path = join(directory, 'render.png');
    await writeFile(
      path,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    try {
      const adapter = new CanvasAppServerToolDispatcher(
        service(
          vi.fn(async () => ({
            path,
            mimeType: 'image/png',
            width: 1,
            height: 1,
            sha256: 'render-hash',
          })),
        ),
        'session-1',
      );

      const response = await adapter.dispatch({
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-render',
        namespace: null,
        tool: 'scene_render',
        arguments: { view: 'candidate' },
      });

      expect(response).toMatchObject({
        success: true,
        contentItems: [
          { type: 'inputText' },
          { type: 'inputImage', imageUrl: expect.stringMatching(/^data:image\/png;base64,/) },
        ],
      });
      const textItem = response.contentItems[0];
      expect(textItem.type === 'inputText' ? textItem.text : '').not.toContain(path);
      expect(textItem.type === 'inputText' ? textItem.text : '').toContain('"imageAttached":true');

      const duplicate = await adapter.dispatch({
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-render-again',
        namespace: null,
        tool: 'scene_render',
        arguments: { view: 'candidate' },
      });
      expect(duplicate.contentItems).toHaveLength(1);
      expect(
        duplicate.contentItems[0].type === 'inputText' ? duplicate.contentItems[0].text : '',
      ).toContain('"imageAttached":false');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exposes bounded candidate mutation arguments and results to activity subscribers', async () => {
    const activity: unknown[] = [];
    const adapter = new CanvasAppServerToolDispatcher(
      service(
        vi.fn(async () => ({
          ok: true,
          appliedOperationIds: ['operation-1'],
          candidateRevisionId: 'candidate-revision-2',
        })),
      ),
      'session-1',
      { onActivity: (event) => activity.push(event) },
    );
    await adapter.dispatch({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-apply',
      namespace: null,
      tool: 'candidate_apply_changes',
      arguments: {
        candidateRevisionId: 'revision-source',
        changes: [
          {
            operation: {
              id: 'operation-1',
              type: 'style',
              actor: 'agent',
              targetIds: ['node-1'],
              patch: { radius: 12 },
            },
            evidenceNodeIds: ['node-1'],
            summary: 'Matched the neighboring card radius.',
          },
        ],
      },
    });

    expect(activity).toMatchObject([
      {
        phase: 'started',
        sessionId: 'session-1',
        callId: 'call-apply',
        tool: 'candidate.apply_changes',
        arguments: { changes: [{ evidenceNodeIds: ['node-1'] }] },
      },
      {
        phase: 'completed',
        result: { candidateRevisionId: 'candidate-revision-2' },
        candidateMutation: {
          candidateRevisionId: 'candidate-revision-2',
          appliedOperationIds: ['operation-1'],
        },
      },
    ]);
  });
});
