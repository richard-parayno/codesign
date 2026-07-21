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
        service(vi.fn(async () => ({ path, mimeType: 'image/png', width: 1, height: 1 }))),
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
