import { afterEach, describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
import { demoCheckpoint } from '$lib/model/checkpoint';
import { deriveGenerationTarget } from '$lib/agent/generation-target';
import { stageCandidates, stageGenerationRun } from '$lib/model/codesign';
import { POST } from './+server';

function body(action: 'complete' | 'vary' = 'complete') {
  const document = applyOperation(blankDocument(), {
    id: 'create-region',
    type: 'create',
    actor: 'user',
    node: {
      id: 'region',
      name: 'Region',
      kind: 'rectangle',
      screenId: 'screen-1',
      childIds: [],
      bounds: { x: 10, y: 10, width: 300, height: 220 },
      style: { ...defaultStyle },
      provenance: { actor: 'user', operationId: 'create-region' },
    },
  });
  return {
    projectId: 'test-project',
    action,
    requestedFidelity: 'component',
    target: {
      focusNodeIds: ['region'],
      observationScope: { kind: 'screen', nodeIds: ['region'] },
      mutationScope: {
        existingNodeIds: ['region'],
        insertionParentIds: [],
        regions: [{ ...document.nodes.region.bounds }],
        allowCreate: true,
      },
    },
    pinnedNodeIds: [],
    pinnedAtomicChanges: [],
    document: {
      currentRevisionId: document.currentRevisionId,
      activeScreenId: document.activeScreenId,
      screenName: document.screens[0].name,
      screenRootIds: document.screens[0].rootIds,
      knownNodeIds: Object.keys(document.nodes),
      nodes: document.nodes,
    },
  };
}

async function post(value: unknown) {
  const request = new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
  return POST({ request } as Parameters<typeof POST>[0]);
}

afterEach(() => {
  delete process.env.CODESIGN_AGENT_BACKEND;
});

describe('POST /api/agent', () => {
  it('returns a deterministic generation run and normalized candidate drafts', async () => {
    process.env.CODESIGN_AGENT_BACKEND = 'local';
    const response = await post(body());
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(value).toMatchObject({
      run: {
        action: 'complete',
        backend: 'local',
        requestedFidelity: 'component',
        target: { mutationScope: { existingNodeIds: ['region'] } },
      },
      fallback: false,
      supportedActions: ['complete'],
      visualInputUsed: false,
    });
    expect(value.candidates[0].atomicChanges).toHaveLength(4);
    expect(value.candidates[0].atomicChanges[0]).toHaveProperty('before');
    expect(value.candidates[0].atomicChanges[0]).toHaveProperty('after');
  });

  it('stages a JSON-roundtripped candidate against a fresh in-memory demo checkpoint', async () => {
    process.env.CODESIGN_AGENT_BACKEND = 'local';
    const document = demoCheckpoint();
    const target = deriveGenerationTarget(document, ['sidebar']);
    const response = await post({
      projectId: 'demo-project',
      action: 'complete',
      requestedFidelity: 'wireframe',
      target,
      pinnedNodeIds: [],
      pinnedAtomicChanges: [],
      document: {
        currentRevisionId: document.currentRevisionId,
        activeScreenId: document.activeScreenId,
        screenName: document.screens[0].name,
        screenRootIds: document.screens[0].rootIds,
        knownNodeIds: Object.keys(document.nodes),
        nodes: Object.fromEntries(
          target.observationScope.nodeIds.map((id) => [id, document.nodes[id]]),
        ),
      },
    });
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(() =>
      stageCandidates(stageGenerationRun(document, value.run), value.run.id, value.candidates),
    ).not.toThrow();
  });

  it('reports unsupported vocabulary instead of exposing a dead action', async () => {
    process.env.CODESIGN_AGENT_BACKEND = 'local';
    const response = await post(body('vary'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      message: 'vary is not available in this build',
      supportedActions: ['complete'],
    });
  });

  it('rejects mutation scope that is not observable', async () => {
    process.env.CODESIGN_AGENT_BACKEND = 'local';
    const invalid = body();
    invalid.target.observationScope.nodeIds = ['missing'];
    const response = await post(invalid);
    expect(response.status).toBe(400);
  });
});
