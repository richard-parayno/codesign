import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import {
  CandidateValidationError,
  PROMPT_VERSION,
  SUPPORTED_ACTIONS,
  createGenerationRun,
  candidateToDocumentCoordinates,
  operationToSceneCoordinates,
  generationRequestSchema,
  normalizeCandidateBatch,
  validateGenerationRequest,
  type CandidateGenerationResponse,
  type GenerationRequest,
} from '$lib/agent/candidate';
import {
  ProviderFailure,
  applyProviderOptions,
  asProviderFailure,
  createProvider,
  providerSettings,
} from '$lib/agent/providers';
import {
  SCENE_CONTEXT_SCHEMA_VERSION,
  buildSceneContext,
  type SceneContext,
} from '$lib/agent/scene-context';
import type { CodesignTelemetryEffort, CodesignTokenUsage } from '$lib/agent/telemetry';
import {
  latestCodesignTelemetry,
  publishCodesignTelemetry,
  telemetryRequestId,
} from '$lib/agent/telemetry.server';
import {
  VisualSnapshotError,
  withTrustedVisualSnapshot,
  type TrustedVisualSnapshot,
} from '$lib/agent/visual-snapshot.server';
import type { CanvasSnapshot, GenerationRun } from '$lib/model/types';

function canvasSnapshot(request: GenerationRequest): CanvasSnapshot {
  return {
    screens: [
      {
        id: request.document.activeScreenId,
        name: request.document.screenName,
        rootIds: request.document.screenRootIds.filter((id) => request.document.nodes[id]),
        branchId: 'generation-context',
      },
    ],
    nodes: structuredClone(request.document.nodes),
    transitions: [],
    branches: [
      {
        id: 'generation-context',
        name: 'Generation context',
        screenIds: [request.document.activeScreenId],
      },
    ],
    activeBranchId: 'generation-context',
    activeScreenId: request.document.activeScreenId,
    entities: {},
    representations: {},
    pinnedNodeIds: [...request.pinnedNodeIds],
    frameFidelity: structuredClone(request.document.frameFidelity),
    nodeFidelityOverrides: structuredClone(request.document.nodeFidelityOverrides),
  };
}

function sceneContext(request: GenerationRequest, trusted?: TrustedVisualSnapshot): SceneContext {
  return buildSceneContext({
    snapshot: canvasSnapshot(request),
    focusNodeIds: request.target.focusNodeIds,
    observationNodeIds: request.target.observationScope.nodeIds,
    observationRootId: request.target.observationScope.rootId ?? null,
    mutationTargetIds: request.target.mutationScope.existingNodeIds,
    mutationScope: request.target.mutationScope,
    action: request.action,
    fidelity: request.requestedFidelity,
    metadata: {
      snapshotId: request.visualSnapshot?.id ?? `context-${request.document.currentRevisionId}`,
      revisionId: request.document.currentRevisionId,
      capturedAt: Date.now(),
      projectId: request.projectId,
      ...(trusted
        ? {
            visual: {
              mimeType: trusted.mimeType,
              width: trusted.width,
              height: trusted.height,
              sha256: trusted.sha256,
            },
          }
        : {}),
    },
  });
}

function generationPrompt(request: GenerationRequest, run: GenerationRun, context: SceneContext) {
  return [
    'Complete the supplied design scene with one coherent candidate batch.',
    'Use the visual snapshot and canonical scene context together. Preserve the existing visual language; do not assume a navbar, dashboard, or any particular product pattern.',
    'Return at least three individually useful atomic changes using only create, style, update-node, move, and resize.',
    'Every new ID must begin with idNamespace plus a hyphen. Respect mutationScope exactly, never mutate pinned nodes, keep creates inside an allowed insertion parent and editable region, and order nested creates after their parent dependency.',
    'Ground observations in observable node IDs. Phrase inferred intent as a proposal, not as a discovered fact.',
    'Preserve every pinnedAtomicChange exactly once with preservedFromAtomicChangeId and fresh namespaced IDs where required.',
    JSON.stringify({
      idNamespace: run.id,
      pinnedNodeIds: run.pinnedNodeIds,
      pinnedAtomicChanges: request.pinnedAtomicChanges.map((change) => ({
        id: change.id,
        operation: operationToSceneCoordinates(change.operation, context.coordinateSpace.origin),
        dependencyIds: change.dependencyIds,
        trace: change.trace,
      })),
      scene: context,
    }),
  ].join('\n');
}

function runMetadata(
  request: GenerationRequest,
  context: SceneContext,
  settings: ReturnType<typeof providerSettings>,
  runId: string,
  createdAt: number,
  trusted?: TrustedVisualSnapshot,
) {
  return createGenerationRun(request, {
    model: settings.model,
    reasoningEffort: settings.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    contextNodeIds: context.nodes.map((node) => node.id),
    contextRootId: context.coordinateSpace.observationRootId ?? undefined,
    contextSummarized: context.summarization.applied,
    contextSchemaVersion: SCENE_CONTEXT_SCHEMA_VERSION,
    trustedSnapshot: trusted
      ? {
          mimeType: trusted.mimeType,
          width: trusted.width,
          height: trusted.height,
          sha256: trusted.sha256,
        }
      : undefined,
    runId,
    createdAt,
  });
}

function errorResponse(cause: unknown, requestId: string) {
  if (cause instanceof CandidateValidationError)
    return json(
      {
        message: cause.message,
        telemetry: latestCodesignTelemetry(requestId),
        ...(cause.message.includes('not available') ? { supportedActions: SUPPORTED_ACTIONS } : {}),
      },
      { status: cause.message.includes('not available') ? 422 : 400 },
    );
  if (cause instanceof VisualSnapshotError)
    return json(
      { message: cause.message, telemetry: latestCodesignTelemetry(requestId) },
      { status: cause.code === 'cancelled' ? 499 : 400 },
    );
  const failure = asProviderFailure(cause);
  const status = {
    'missing-login': 401,
    'model-unavailable': 422,
    'rate-limited': 429,
    cancelled: 499,
    'protocol-failure': 502,
    unavailable: 503,
  }[failure.category];
  return json(
    {
      message: failure.message,
      category: failure.category,
      telemetry: latestCodesignTelemetry(requestId),
    },
    { status },
  );
}

export async function POST({ request }) {
  const requestId = telemetryRequestId(request.headers.get('x-codesign-request-id'));
  const startedAt = Date.now();
  const parsed = generationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    publishCodesignTelemetry(requestId, {
      phase: 'failed',
      message: 'The Codesign request was invalid.',
      durationMs: Date.now() - startedAt,
    });
    return json(
      {
        message: 'Invalid Codesign generation request',
        issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
        telemetry: latestCodesignTelemetry(requestId),
      },
      { status: 400 },
    );
  }
  const input = parsed.data;
  let latestUsage: CodesignTokenUsage | undefined;
  let transportDurationMs: number | undefined;
  try {
    publishCodesignTelemetry(requestId, {
      phase: 'preparing',
      message: 'Preparing scene context for Codesign.',
    });
    validateGenerationRequest(input);
    const settings = applyProviderOptions(providerSettings(), input.providerOptions);
    const telemetryEffort = settings.effort as CodesignTelemetryEffort;
    const provider = createProvider(settings);
    const status = await provider.status();
    if (!status.available) throw new ProviderFailure(status.failureCategory ?? 'unavailable');
    if (!status.connected) throw new ProviderFailure('missing-login');
    const runId = `generation-${randomUUID()}`;
    const createdAt = Date.now();
    if (!input.visualSnapshot)
      throw new CandidateValidationError('AI scene generation requires a visual snapshot');

    const response = await withTrustedVisualSnapshot(
      { mimeType: input.visualSnapshot.mimeType, base64: input.visualSnapshot.data },
      async (trusted, generationSignal) => {
        if (
          trusted.width !== input.visualSnapshot?.width ||
          trusted.height !== input.visualSnapshot?.height
        )
          throw new VisualSnapshotError(
            'Visual snapshot dimensions do not match the uploaded image',
            'invalid-dimensions',
          );
        const context = sceneContext(input, trusted);
        const run = runMetadata(input, context, settings, runId, createdAt, trusted);
        const prompt = generationPrompt(input, run, context);
        publishCodesignTelemetry(requestId, {
          phase: 'prompt-sent',
          message: 'Codesign prompt sent to Codex.',
          model: settings.model,
          effort: telemetryEffort,
          promptVersion: PROMPT_VERSION,
          contextNodeCount: context.nodes.length,
          promptCharacters: prompt.length,
        });
        const relativeWire = await provider.generate({
          request: input,
          run,
          prompt,
          signal: generationSignal,
          visualInput: { type: 'localImage', path: trusted.path, detail: 'original' },
          model: settings.model,
          effort: settings.effort,
          onTelemetry: (event) => {
            if (event.type === 'output-started') {
              publishCodesignTelemetry(requestId, {
                phase: 'streaming',
                message: 'Codex is returning a structured proposal.',
                model: settings.model,
                effort: telemetryEffort,
              });
              return;
            }
            if (event.type === 'token-usage') {
              latestUsage = event.usage;
              publishCodesignTelemetry(requestId, {
                phase: 'streaming',
                message: 'Codex token usage updated.',
                model: settings.model,
                effort: telemetryEffort,
                usage: event.usage,
              });
              return;
            }
            transportDurationMs = event.durationMs;
          },
        });
        publishCodesignTelemetry(requestId, {
          phase: 'validating',
          message: 'Validating the structured Codesign proposal.',
          model: settings.model,
          effort: telemetryEffort,
          ...(latestUsage ? { usage: latestUsage } : {}),
        });
        const wire = candidateToDocumentCoordinates(relativeWire, context.coordinateSpace.origin);
        const candidates = [normalizeCandidateBatch(input, run, wire)];
        const completed = publishCodesignTelemetry(requestId, {
          phase: 'completed',
          message: 'Codesign proposal is ready for review.',
          model: settings.model,
          effort: telemetryEffort,
          promptVersion: PROMPT_VERSION,
          contextNodeCount: context.nodes.length,
          promptCharacters: prompt.length,
          outputCharacters: JSON.stringify(relativeWire).length,
          durationMs: transportDurationMs ?? Date.now() - startedAt,
          ...(latestUsage ? { usage: latestUsage } : {}),
        });
        return {
          run,
          candidates,
          supportedActions: SUPPORTED_ACTIONS,
          visualInputUsed: true,
          telemetry: completed,
        } satisfies CandidateGenerationResponse;
      },
      { signal: request.signal },
    );
    return json(response);
  } catch (cause) {
    const failure =
      cause instanceof VisualSnapshotError && cause.code === 'cancelled'
        ? 'cancelled'
        : asProviderFailure(cause).category === 'cancelled'
          ? 'cancelled'
          : 'failed';
    publishCodesignTelemetry(requestId, {
      phase: failure,
      message:
        failure === 'cancelled'
          ? 'Codesign generation was cancelled.'
          : 'Codesign generation could not be completed.',
      durationMs: Date.now() - startedAt,
      ...(latestUsage ? { usage: latestUsage } : {}),
    });
    return errorResponse(cause, requestId);
  }
}
