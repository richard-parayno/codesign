import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import {
  CandidateValidationError,
  PROMPT_VERSION,
  SUPPORTED_ACTIONS,
  createGenerationRun,
  candidateToDocumentCoordinates,
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
import { renderCodesignPrompt } from '$lib/agent/prompt-template';
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
import { codesignFailureDiagnostic, type CodesignFailureStage } from '$lib/agent/failure';
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

function errorResponse(
  cause: unknown,
  requestId: string,
  providerFailure = asProviderFailure(cause),
) {
  if (cause instanceof CandidateValidationError)
    return json(
      {
        requestId,
        message: cause.message,
        diagnostic: providerFailure.diagnostic,
        telemetry: latestCodesignTelemetry(requestId),
        ...(cause.message.includes('not available') ? { supportedActions: SUPPORTED_ACTIONS } : {}),
      },
      { status: cause.message.includes('not available') ? 422 : 400 },
    );
  if (cause instanceof VisualSnapshotError)
    return json(
      {
        requestId,
        message: cause.message,
        diagnostic: providerFailure.diagnostic,
        telemetry: latestCodesignTelemetry(requestId),
      },
      { status: cause.code === 'cancelled' ? 499 : 400 },
    );
  const status = {
    'missing-login': 401,
    'model-unavailable': 422,
    'rate-limited': 429,
    cancelled: 499,
    'protocol-failure': 502,
    unavailable: 503,
  }[providerFailure.category];
  return json(
    {
      requestId,
      message: providerFailure.message,
      category: providerFailure.category,
      diagnostic: providerFailure.diagnostic,
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
    const issues = parsed.error.issues.slice(0, 5).map((issue) => issue.message);
    const diagnostic = {
      stage: 'request-validation' as const,
      message: issues.join('; ') || 'Invalid Codesign generation request',
      errorName: 'ZodError',
    };
    const durationMs = Date.now() - startedAt;
    console.error(
      `[codesign:ai:error] ${JSON.stringify({
        requestId,
        category: 'protocol-failure',
        ...diagnostic,
        durationMs,
      })}`,
    );
    publishCodesignTelemetry(requestId, {
      phase: 'failed',
      message: 'The Codesign request was invalid.',
      durationMs,
      failure: { category: 'protocol-failure', ...diagnostic },
    });
    return json(
      {
        requestId,
        message: 'Invalid Codesign generation request',
        issues,
        diagnostic,
        telemetry: latestCodesignTelemetry(requestId),
      },
      { status: 400 },
    );
  }
  const input = parsed.data;
  let latestUsage: CodesignTokenUsage | undefined;
  let transportDurationMs: number | undefined;
  let failureStage: CodesignFailureStage = 'request-validation';
  try {
    publishCodesignTelemetry(requestId, {
      phase: 'preparing',
      message: 'Preparing scene context for Codesign.',
    });
    validateGenerationRequest(input);
    failureStage = 'provider-status';
    const settings = applyProviderOptions(providerSettings(), input.providerOptions);
    const telemetryEffort = settings.effort as CodesignTelemetryEffort;
    const provider = createProvider(settings);
    const status = await provider.status();
    if (!status.available) throw new ProviderFailure(status.failureCategory ?? 'unavailable');
    if (!status.connected) throw new ProviderFailure('missing-login');
    const runId = `generation-${randomUUID()}`;
    const createdAt = Date.now();
    failureStage = 'snapshot-validation';
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
        failureStage = 'prompt-construction';
        const context = sceneContext(input, trusted);
        const run = runMetadata(input, context, settings, runId, createdAt, trusted);
        const prompt = renderCodesignPrompt(input, run, context);
        publishCodesignTelemetry(requestId, {
          phase: 'prompt-sent',
          message: 'Codesign prompt sent to Codex.',
          model: settings.model,
          effort: telemetryEffort,
          promptVersion: PROMPT_VERSION,
          contextNodeCount: context.nodes.length,
          promptCharacters: prompt.length,
          renderedPrompt: prompt,
        });
        failureStage = 'generation';
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
        failureStage = 'candidate-validation';
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
    const providerFailure =
      cause instanceof CandidateValidationError
        ? new ProviderFailure('protocol-failure', codesignFailureDiagnostic(cause, failureStage))
        : cause instanceof VisualSnapshotError
          ? new ProviderFailure(
              cause.code === 'cancelled' ? 'cancelled' : 'protocol-failure',
              codesignFailureDiagnostic(cause, failureStage),
            )
          : asProviderFailure(cause, failureStage);
    const telemetryPhase = providerFailure.category === 'cancelled' ? 'cancelled' : 'failed';
    const diagnostic = providerFailure.diagnostic ?? codesignFailureDiagnostic(cause, failureStage);
    const durationMs = Date.now() - startedAt;
    console.error(
      `[codesign:ai:error] ${JSON.stringify({
        requestId,
        category: providerFailure.category,
        ...diagnostic,
        durationMs,
      })}`,
    );
    publishCodesignTelemetry(requestId, {
      phase: telemetryPhase,
      message:
        telemetryPhase === 'cancelled'
          ? 'Codesign generation was cancelled.'
          : 'Codesign generation could not be completed.',
      durationMs,
      failure: { category: providerFailure.category, ...diagnostic },
      ...(latestUsage ? { usage: latestUsage } : {}),
    });
    return errorResponse(cause, requestId, providerFailure);
  }
}
