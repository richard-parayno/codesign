import { afterEach, describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
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
    action,
    requestedFidelity: 'component',
    observationScope: { kind: 'selection', nodeIds: ['region'] },
    mutationScopeIds: ['region'],
    pinnedNodeIds: [],
    pinnedAtomicChanges: [],
    document: {
      currentRevisionId: document.currentRevisionId,
      activeScreenId: document.activeScreenId,
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
        mutationScopeIds: ['region'],
      },
      fallback: false,
      supportedActions: ['complete'],
      visualInputUsed: false,
    });
    expect(value.candidates[0].atomicChanges).toHaveLength(4);
    expect(value.candidates[0].atomicChanges[0]).toHaveProperty('before');
    expect(value.candidates[0].atomicChanges[0]).toHaveProperty('after');
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
    invalid.observationScope.nodeIds = ['missing'];
    const response = await post(invalid);
    expect(response.status).toBe(400);
  });
});
