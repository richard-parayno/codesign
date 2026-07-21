import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
import { candidateBatchFixture } from '$lib/agent/fixtures/candidate-batch-fixture';

const mockProvider = vi.hoisted(() => ({
  status: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('$lib/agent/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/agent/providers')>()),
  createProvider: () => mockProvider,
}));

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
    visualSnapshot: {
      id: 'snapshot-1',
      mimeType: 'image/png',
      width: 2,
      height: 2,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=',
    },
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

beforeEach(() => {
  mockProvider.status.mockReset();
  mockProvider.generate.mockReset();
  mockProvider.status.mockResolvedValue({
    provider: 'codex',
    available: true,
    connected: true,
    authMode: 'chatgpt',
    planType: 'plus',
    accountLabel: null,
    message: 'Codex App Server is connected.',
  });
  mockProvider.generate.mockImplementation(({ request, run }) => {
    const wire = candidateBatchFixture(request, run);
    const origin = request.target.mutationScope.regions[0];
    for (const change of wire.candidate.atomicChanges) {
      if (change.operation.type !== 'create') continue;
      change.operation.node.bounds.x -= origin.x;
      change.operation.node.bounds.y -= origin.y;
    }
    return wire;
  });
});

describe('POST /api/agent', () => {
  it('normalizes a mocked Codex response through the endpoint', async () => {
    const response = await post(body());
    const value = await response.json();
    expect(response.status).toBe(200);
    expect(value).toMatchObject({
      run: { provider: 'codex', requestedFidelity: 'component' },
      supportedActions: ['complete'],
      visualInputUsed: true,
    });
    expect(value).not.toHaveProperty('fallback');
    expect(value.candidates[0].atomicChanges).toHaveLength(4);
  });

  it('reports unsupported vocabulary instead of exposing a dead action', async () => {
    const response = await post(body('vary'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      message: 'vary is not available in this build',
      supportedActions: ['complete'],
    });
  });

  it('rejects mutation scope that is not observable', async () => {
    const invalid = body();
    invalid.target.observationScope.nodeIds = ['missing'];
    const response = await post(invalid);
    expect(response.status).toBe(400);
  });

  it.each([
    [
      'signed out',
      {
        provider: 'codex',
        available: true,
        connected: false,
        failureCategory: 'missing-login',
        message: 'Sign in to Codex with ChatGPT to enable AI generation.',
      },
      401,
      'missing-login',
    ],
    [
      'unavailable',
      {
        provider: 'codex',
        available: false,
        connected: false,
        failureCategory: 'unavailable',
        message: 'The local Codex runtime is unavailable.',
      },
      503,
      'unavailable',
    ],
  ])(
    'returns %s status without manufacturing a candidate',
    async (_label, status, code, category) => {
      mockProvider.status.mockResolvedValue(status);

      const response = await post(body());

      expect(response.status).toBe(code);
      await expect(response.json()).resolves.toMatchObject({ category });
      expect(mockProvider.generate).not.toHaveBeenCalled();
    },
  );
});
