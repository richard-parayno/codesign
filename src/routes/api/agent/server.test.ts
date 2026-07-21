import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
import type { GenerationRequest } from '$lib/agent/candidate';
import type { CodexCanvasSessionOptions } from '$lib/agent/codex-client.server';
import type { CanvasSessionService } from '$lib/agent/harness/contracts';
const mockProvider = vi.hoisted(() => ({
  status: vi.fn(),
}));
const mockClient = vi.hoisted(() => ({ runCanvasSession: vi.fn() }));

vi.mock('$lib/agent/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/agent/providers')>()),
  createProvider: () => mockProvider,
}));
vi.mock('$lib/agent/codex-client.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/agent/codex-client.server')>()),
  getCodexClient: () => mockClient,
}));

import { DELETE, POST } from './+server';

function body(action: 'complete' | 'vary' = 'complete'): GenerationRequest {
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
      frameFidelity: {},
      nodeFidelityOverrides: {},
    },
  };
}

async function post(value: unknown, requestId?: string) {
  const request = new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(requestId ? { 'x-codesign-request-id': requestId } : {}),
    },
    body: JSON.stringify(value),
  });
  return POST({ request } as Parameters<typeof POST>[0]);
}

async function completeSession(
  _prompt: string,
  sessionId: string,
  service: CanvasSessionService,
  _signal?: AbortSignal,
  options?: CodexCanvasSessionOptions,
) {
  const state = (await service.dispatch(sessionId, 'candidate.get_state', {})) as {
    candidateRevisionId: string;
  };
  await service.dispatch(sessionId, 'components.describe', { ids: ['Button'] });
  const argumentsValue = {
    candidateRevisionId: state.candidateRevisionId,
    changes: [
      {
        operation: {
          id: 'operation-agent-promote',
          type: 'promote' as const,
          actor: 'agent' as const,
          targetIds: ['region'],
          componentId: 'Button',
          props: { variant: 'default' },
        },
        evidenceNodeIds: ['region'],
        summary: 'Promoted the selected region to the installed Button component.',
      },
    ],
  };
  options?.onToolActivity?.({
    phase: 'started',
    sessionId,
    callId: 'call-apply',
    tool: 'candidate.apply_changes',
    arguments: argumentsValue,
  });
  const applied = await service.dispatch(sessionId, 'candidate.apply_changes', argumentsValue);
  options?.onToolActivity?.({
    phase: 'completed',
    sessionId,
    callId: 'call-apply',
    tool: 'candidate.apply_changes',
    result: applied,
    candidateMutation: {
      candidateRevisionId: (applied as { candidateRevisionId: string }).candidateRevisionId,
      appliedOperationIds: ['operation-agent-promote'],
    },
  });
  await service.dispatch(sessionId, 'candidate.validate', {});
  const submission = await service.dispatch(sessionId, 'candidate.submit', {});
  return { assistantText: '', submitted: true as const, submission };
}

beforeEach(() => {
  vi.spyOn(console, 'info')
    .mockClear()
    .mockImplementation(() => {});
  vi.spyOn(console, 'error')
    .mockClear()
    .mockImplementation(() => {});
  mockProvider.status.mockReset();
  mockClient.runCanvasSession.mockReset();
  mockProvider.status.mockResolvedValue({
    provider: 'codex',
    available: true,
    connected: true,
    authMode: 'chatgpt',
    planType: 'plus',
    accountLabel: null,
    message: 'Codex App Server is connected.',
  });
  mockClient.runCanvasSession.mockImplementation(completeSession);
});

describe('POST /api/agent', () => {
  it('runs a mocked iterative canvas session through the endpoint', async () => {
    const response = await post(body());
    const value = await response.json();
    expect(response.status).toBe(200);
    expect(value).toMatchObject({
      run: { provider: 'codex', requestedFidelity: 'component' },
      supportedActions: ['complete'],
      visualInputUsed: false,
    });
    expect(value).not.toHaveProperty('fallback');
    expect(value.candidates[0].atomicChanges).toHaveLength(1);
    expect(mockClient.runCanvasSession).toHaveBeenCalledOnce();
  });

  it('seeds and preserves pinned review changes during reroll sessions', async () => {
    const request = body();
    const beforeNode = structuredClone(request.document.nodes.region);
    const afterNode = structuredClone(beforeNode);
    afterNode.style.fill = '#7c3aed';
    request.pinnedAtomicChanges = [
      {
        id: 'atomic-pinned-fill',
        candidateId: 'candidate-previous',
        operation: {
          id: 'operation-pinned-fill',
          type: 'style',
          actor: 'agent',
          targetIds: ['region'],
          patch: { fill: '#7c3aed' },
        },
        dependencyIds: [],
        trace: {
          observation: 'Observed the selected region.',
          context: 'The preserved accent distinguishes the region.',
          inference: 'Keep the approved accent during reroll.',
          proposedChange: 'Preserved the approved accent fill.',
          evidenceNodeIds: ['region'],
          affectedNodeIds: ['region'],
        },
        before: { nodes: { region: beforeNode } },
        after: { nodes: { region: afterNode } },
      },
    ];

    const response = await post(request);
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(value.candidates[0].atomicChanges).toHaveLength(2);
    expect(value.candidates[0].atomicChanges[0]).toMatchObject({
      operation: { id: 'operation-pinned-fill' },
      preservedFromAtomicChangeId: 'atomic-pinned-fill',
    });
  });

  it('returns measured Codex usage and logs safe backend lifecycle events', async () => {
    mockClient.runCanvasSession.mockImplementationOnce(async (...args) => {
      const options = args[4];
      options?.onTelemetry?.({ type: 'thread-started', durationMs: 12 });
      options?.onTelemetry?.({ type: 'turn-started', durationMs: 8 });
      options?.onTelemetry?.({ type: 'output-started' });
      options?.onTelemetry?.({
        type: 'token-usage',
        usage: {
          totalTokens: 240,
          inputTokens: 180,
          cachedInputTokens: 30,
          outputTokens: 60,
          reasoningOutputTokens: 12,
          modelContextWindow: 200_000,
        },
      });
      options?.onTelemetry?.({ type: 'turn-completed', durationMs: 654 });
      return completeSession(
        args[0] as string,
        args[1] as string,
        args[2] as CanvasSessionService,
        args[3] as AbortSignal | undefined,
        options as CodexCanvasSessionOptions | undefined,
      );
    });

    const response = await post(body());
    const value = await response.json();

    expect(value.telemetry).toMatchObject({
      phase: 'completed',
      durationMs: 654,
      usage: {
        totalTokens: 240,
        inputTokens: 180,
        cachedInputTokens: 30,
        outputTokens: 60,
        reasoningOutputTokens: 12,
      },
    });
    const backendEvents = vi.mocked(console.info).mock.calls.map(([line]) => String(line));
    expect(backendEvents.some((line) => line.includes('"phase":"prompt-sent"'))).toBe(true);
    expect(backendEvents.some((line) => line.includes('"totalTokens":240'))).toBe(true);
    expect(backendEvents.join(' ')).not.toContain('Complete the supplied design scene');
  });

  it('logs and returns the underlying provider failure with its request stage', async () => {
    mockClient.runCanvasSession.mockRejectedValueOnce(
      new Error('output schema rejected candidate.atomicChanges at column 42'),
    );

    const response = await post(body(), 'codesign-diagnostic-test');
    const value = await response.json();

    expect(response.status).toBe(502);
    expect(value).toMatchObject({
      requestId: 'codesign-diagnostic-test',
      category: 'protocol-failure',
      diagnostic: {
        stage: 'generation',
        errorName: 'Error',
        message: 'output schema rejected candidate.atomicChanges at column 42',
      },
      telemetry: {
        phase: 'failed',
        failure: {
          stage: 'generation',
          category: 'protocol-failure',
          message: 'output schema rejected candidate.atomicChanges at column 42',
        },
      },
    });
    const errorLines = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toContain('[codesign:ai:error]');
    expect(errorLines[0]).toContain('codesign-diagnostic-test');
    expect(errorLines[0]).toContain('output schema rejected candidate.atomicChanges at column 42');
  });

  it('reports unsupported vocabulary instead of exposing a dead action', async () => {
    const response = await post(body('vary'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      message: 'vary is not available in this build',
      supportedActions: ['complete'],
    });
  });

  it('cancels an active canvas-agent run by request ID', async () => {
    let observedSignal: AbortSignal | undefined;
    mockClient.runCanvasSession.mockImplementationOnce(
      (_prompt, _sessionId, _service, signal) =>
        new Promise((_resolve, reject) => {
          observedSignal = signal;
          signal?.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('Canvas agent session cancelled'), { name: 'AbortError' }),
              ),
            { once: true },
          );
        }),
    );

    const pending = post(body(), 'codesign-cancel-test');
    await vi.waitFor(() => expect(mockClient.runCanvasSession).toHaveBeenCalledOnce());

    const cancellation = await DELETE({
      request: new Request('http://localhost/api/agent', {
        method: 'DELETE',
        headers: { 'x-codesign-request-id': 'codesign-cancel-test' },
      }),
    } as Parameters<typeof DELETE>[0]);

    expect(cancellation.status).toBe(200);
    await expect(cancellation.json()).resolves.toEqual({
      cancelled: true,
      requestId: 'codesign-cancel-test',
    });
    expect(observedSignal?.aborted).toBe(true);
    expect((await pending).status).toBe(499);
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
      expect(mockClient.runCanvasSession).not.toHaveBeenCalled();
    },
  );
});
