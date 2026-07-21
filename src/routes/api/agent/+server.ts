import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import {
  CandidateValidationError,
  PROMPT_VERSION,
  SUPPORTED_ACTIONS,
  candidateFromCanvasSession,
  canvasSessionSubmissionSchema,
  createGenerationRun,
  documentFromGenerationRequest,
  generationRequestSchema,
  validateGenerationRequest,
  type CandidateGenerationResponse,
} from '$lib/agent/candidate';
import { getCodexClient, type CodexTransportTelemetryEvent } from '$lib/agent/codex-client.server';
import { codesignFailureDiagnostic, type CodesignFailureStage } from '$lib/agent/failure';
import { CanvasSessionService } from '$lib/agent/harness/canvas-session.server';
import type { CanvasToolActivity } from '$lib/agent/harness/app-server-tools.server';
import { renderCodesignPrompt } from '$lib/agent/prompt-template';
import {
  ProviderFailure,
  applyProviderOptions,
  asProviderFailure,
  createProvider,
  providerSettings,
} from '$lib/agent/providers';
import type { CodesignTelemetryEffort, CodesignTokenUsage } from '$lib/agent/telemetry';
import {
  latestCodesignTelemetry,
  publishCodesignTelemetry,
  telemetryRequestId,
} from '$lib/agent/telemetry.server';

const CONTEXT_SCHEMA_VERSION = 'codesign-canvas-session-v1';

type ActiveCanvasRun = {
  controller: AbortController;
  service: CanvasSessionService;
  sessionId: string;
};

declare global {
  var __codesignActiveCanvasRuns: Map<string, ActiveCanvasRun> | undefined;
}

const activeCanvasRuns = (globalThis.__codesignActiveCanvasRuns ??= new Map());

function errorResponse(cause: unknown, requestId: string, failure = asProviderFailure(cause)) {
  if (cause instanceof CandidateValidationError)
    return json(
      {
        requestId,
        message: cause.message,
        diagnostic: failure.diagnostic,
        telemetry: latestCodesignTelemetry(requestId),
        ...(cause.message.includes('not available') ? { supportedActions: SUPPORTED_ACTIONS } : {}),
      },
      { status: cause.message.includes('not available') ? 422 : 400 },
    );
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
      requestId,
      message: failure.message,
      category: failure.category,
      diagnostic: failure.diagnostic,
      telemetry: latestCodesignTelemetry(requestId),
    },
    { status },
  );
}

function toolPhase(tool: CanvasToolActivity['tool']) {
  if (tool === 'scene.render') return 'rendering' as const;
  if (tool.startsWith('scene.') || tool === 'candidate.get_state') return 'inspecting' as const;
  if (tool.startsWith('components.')) return 'components' as const;
  if (tool === 'candidate.apply_changes') return 'applying' as const;
  if (tool === 'candidate.validate') return 'validating' as const;
  return 'submitting' as const;
}

function toolMessage(activity: CanvasToolActivity) {
  const verb =
    activity.phase === 'started'
      ? 'Running'
      : activity.phase === 'completed'
        ? 'Completed'
        : 'Could not complete';
  return `${verb} ${activity.tool}.`;
}

function modelTimeoutMs(environment: NodeJS.ProcessEnv = process.env) {
  const configured = Number(environment.CODESIGN_AGENT_TIMEOUT_MS ?? 180_000);
  return Number.isInteger(configured) && configured >= 1_000 && configured <= 10 * 60_000
    ? configured
    : 180_000;
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
    console.error(
      `[codesign:ai:error] ${JSON.stringify({
        requestId,
        category: 'protocol-failure',
        ...diagnostic,
        durationMs: Date.now() - startedAt,
      })}`,
    );
    publishCodesignTelemetry(requestId, {
      phase: 'failed',
      message: 'The Codesign request was invalid.',
      durationMs: Date.now() - startedAt,
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
  const service = new CanvasSessionService();
  const generationController = new AbortController();
  const abortGeneration = () => generationController.abort();
  request.signal.addEventListener('abort', abortGeneration, { once: true });
  let sessionId = '';
  let latestUsage: CodesignTokenUsage | undefined;
  let transportDurationMs: number | undefined;
  let failureStage: CodesignFailureStage = 'request-validation';
  try {
    publishCodesignTelemetry(requestId, {
      phase: 'preparing',
      message: 'Creating a scoped Codesign canvas session.',
    });
    validateGenerationRequest(input);
    failureStage = 'provider-status';
    const settings = applyProviderOptions(providerSettings(), input.providerOptions);
    const telemetryEffort = settings.effort as CodesignTelemetryEffort;
    const provider = createProvider(settings);
    const status = await provider.status();
    if (!status.available) throw new ProviderFailure(status.failureCategory ?? 'unavailable');
    if (!status.connected) throw new ProviderFailure('missing-login');

    failureStage = 'prompt-construction';
    const createdAt = Date.now();
    const pinnedOperationIdByAtomicId = new Map(
      input.pinnedAtomicChanges.map((change) => [change.id, change.operation.id]),
    );
    const session = await service.createSession({
      document: documentFromGenerationRequest(input),
      target: input.target,
      pinnedNodeIds: input.pinnedNodeIds,
      pinnedChangeIds: input.pinnedAtomicChanges.map((change) => change.operation.id),
      seedChanges: input.pinnedAtomicChanges.map((change) => ({
        operation: change.operation,
        dependencyIds: change.dependencyIds.map((id) => pinnedOperationIdByAtomicId.get(id)!),
        evidenceNodeIds: change.trace.evidenceNodeIds,
        summary: change.trace.proposedChange,
      })),
      requestedFidelity: input.requestedFidelity,
      action: input.action,
      model: settings.model,
      backend: 'codex-app-server-dynamic-tools',
    });
    sessionId = session.id;
    activeCanvasRuns.set(requestId, {
      controller: generationController,
      service,
      sessionId,
    });
    const run = createGenerationRun(input, {
      runId: `generation-${randomUUID()}`,
      createdAt,
      model: settings.model,
      reasoningEffort: settings.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      contextNodeIds: input.target.observationScope.nodeIds,
      contextRootId: input.target.observationScope.rootId,
      contextSummarized: true,
      contextSchemaVersion: CONTEXT_SCHEMA_VERSION,
    });
    const prompt = renderCodesignPrompt(input, session);
    publishCodesignTelemetry(requestId, {
      phase: 'prompt-sent',
      message: 'Compact canvas-session prompt sent to Codex.',
      model: settings.model,
      effort: telemetryEffort,
      promptVersion: PROMPT_VERSION,
      contextNodeCount: input.target.observationScope.nodeIds.length,
      promptCharacters: prompt.length,
      renderedPrompt: prompt,
      durationMs: Date.now() - createdAt,
    });

    let firstAgentActivity = true;
    const onTelemetry = (event: CodexTransportTelemetryEvent) => {
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
      if (event.type === 'turn-completed') {
        transportDurationMs = event.durationMs;
        return;
      }
      publishCodesignTelemetry(requestId, {
        phase: event.type === 'output-started' ? 'streaming' : 'prompt-sent',
        message:
          event.type === 'thread-started'
            ? 'Codex App Server thread created.'
            : event.type === 'turn-started'
              ? 'Codex canvas-agent turn acknowledged.'
              : 'Codex agent output started.',
        model: settings.model,
        effort: telemetryEffort,
        ...('durationMs' in event ? { durationMs: event.durationMs } : {}),
      });
    };
    const onToolActivity = (activity: CanvasToolActivity) => {
      publishCodesignTelemetry(requestId, {
        phase: toolPhase(activity.tool),
        message: toolMessage(activity),
        model: settings.model,
        effort: telemetryEffort,
        durationMs:
          firstAgentActivity && activity.phase === 'started'
            ? Date.now() - startedAt
            : activity.durationMs,
        toolActivity: activity,
        ...(latestUsage ? { usage: latestUsage } : {}),
      });
      firstAgentActivity = false;
    };

    failureStage = 'generation';
    const client = getCodexClient(settings.command, settings.model, settings.effort);
    const result = await client.runCanvasSession(
      prompt,
      session.id,
      service,
      generationController.signal,
      {
        model: settings.model,
        effort: settings.effort,
        timeoutMs: modelTimeoutMs(),
        onTelemetry,
        onToolActivity,
      },
    );
    failureStage = 'candidate-validation';
    const submission = canvasSessionSubmissionSchema.parse(result.submission);
    const candidate = candidateFromCanvasSession(input, run, submission);
    const completed = publishCodesignTelemetry(requestId, {
      phase: 'completed',
      message: 'Codesign candidate is ready for review.',
      model: settings.model,
      effort: telemetryEffort,
      promptVersion: PROMPT_VERSION,
      contextNodeCount: input.target.observationScope.nodeIds.length,
      promptCharacters: prompt.length,
      outputCharacters: result.assistantText.length,
      durationMs: transportDurationMs ?? Date.now() - startedAt,
      ...(latestUsage ? { usage: latestUsage } : {}),
    });
    return json({
      run,
      candidates: [candidate],
      supportedActions: SUPPORTED_ACTIONS,
      visualInputUsed: false,
      telemetry: completed,
    } satisfies CandidateGenerationResponse);
  } catch (cause) {
    const failure =
      cause instanceof CandidateValidationError
        ? new ProviderFailure('protocol-failure', codesignFailureDiagnostic(cause, failureStage))
        : asProviderFailure(cause, failureStage);
    const phase = failure.category === 'cancelled' ? 'cancelled' : 'failed';
    const diagnostic = failure.diagnostic ?? codesignFailureDiagnostic(cause, failureStage);
    console.error(
      `[codesign:ai:error] ${JSON.stringify({
        requestId,
        sessionId: sessionId || undefined,
        category: failure.category,
        ...diagnostic,
        durationMs: Date.now() - startedAt,
      })}`,
    );
    publishCodesignTelemetry(requestId, {
      phase,
      message:
        phase === 'cancelled'
          ? 'Codesign generation was cancelled.'
          : 'Codesign agent session could not be completed.',
      durationMs: Date.now() - startedAt,
      failure: { category: failure.category, ...diagnostic },
      ...(latestUsage ? { usage: latestUsage } : {}),
    });
    return errorResponse(cause, requestId, failure);
  } finally {
    request.signal.removeEventListener('abort', abortGeneration);
    if (activeCanvasRuns.get(requestId)?.controller === generationController)
      activeCanvasRuns.delete(requestId);
    if (sessionId) await service.cancelSession(sessionId).catch(() => false);
    await service.dispose();
    console.info(
      `[codesign:ai:cleanup] ${JSON.stringify({
        requestId,
        sessionId: sessionId || undefined,
        durationMs: Date.now() - startedAt,
      })}`,
    );
  }
}

export async function DELETE({ request }) {
  const requestId = request.headers.get('x-codesign-request-id');
  if (!requestId) return json({ message: 'Codesign request ID is required' }, { status: 400 });
  const active = activeCanvasRuns.get(requestId);
  if (!active) return json({ cancelled: false, requestId }, { status: 404 });
  active.controller.abort();
  await active.service.cancelSession(active.sessionId);
  return json({ cancelled: true, requestId });
}
