import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import {
  CandidateValidationError,
  SUPPORTED_ACTIONS,
  createGenerationRun,
  generationRequestSchema,
  normalizeCandidateBatch,
  safeAgentContext,
  validateGenerationRequest,
  type CandidateGenerationResponse,
  type GenerationRequest,
} from '$lib/agent/candidate';
import { getCodexClient } from '$lib/agent/codex-client.server';
import { localCandidateBatch } from '$lib/agent/local';
import { componentRegistry } from '$lib/design-system/registry';

function parseJson(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed) as unknown;
}

function backendSetting() {
  return env.CODESIGN_AGENT_BACKEND ?? env.MALLEABLE_AGENT_BACKEND ?? 'local';
}

function commandSetting() {
  return env.CODESIGN_CODEX_COMMAND ?? env.MALLEABLE_CODEX_COMMAND ?? 'codex';
}

function modelSetting() {
  return env.CODESIGN_CODEX_MODEL ?? env.MALLEABLE_CODEX_MODEL ?? undefined;
}

function localResponse(
  request: GenerationRequest,
  runId: string,
  createdAt: number,
  fallback: boolean,
  message?: string,
): CandidateGenerationResponse {
  const run = createGenerationRun(request, { backend: 'local', runId, createdAt });
  const wire = localCandidateBatch(request, run);
  return {
    run,
    candidates: [normalizeCandidateBatch(request, run, wire)],
    fallback,
    supportedActions: SUPPORTED_ACTIONS,
    visualInputUsed: false,
    message,
  };
}

export async function POST({ request }) {
  const parsed = generationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json(
      {
        message: 'Invalid Codesign generation request',
        issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
      },
      { status: 400 },
    );
  const input = parsed.data;
  try {
    validateGenerationRequest(input);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Invalid generation scope';
    const status = message.includes('not available') ? 422 : 400;
    return json({ message, supportedActions: SUPPORTED_ACTIONS }, { status });
  }

  const runId = `generation-${randomUUID()}`;
  const createdAt = Date.now();
  if (backendSetting() !== 'codex') {
    try {
      return json(localResponse(input, runId, createdAt, false));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Local generation failed';
      return json({ message }, { status: cause instanceof CandidateValidationError ? 400 : 500 });
    }
  }

  const model = modelSetting();
  const run = createGenerationRun(input, {
    backend: 'codex',
    model,
    runId,
    createdAt,
  });
  const safeContext = {
    ...safeAgentContext(input, run),
    supportedOperations: ['create', 'style'],
    allowedStyleValues: {
      colors: [
        'transparent',
        '#ffffff',
        '#f6f7f9',
        '#eef0f3',
        '#d9dde3',
        '#a7adb7',
        '#747b88',
        '#20242b',
        '#2563eb',
      ],
      radius: [0, 4, 8, 12, 16],
      padding: [0, 4, 8, 12, 16, 24],
      fontSize: [12, 14, 16, 20, 24],
      density: ['compact', 'comfortable'],
    },
    registry: Object.values(componentRegistry).map(({ id, allowedProps, slots }) => ({
      id,
      allowedProps,
      slots,
    })),
  };
  const prompt = [
    'Produce one Codesign visual-autocomplete candidate batch for the supplied bounded scene.',
    'Return at least three individually useful atomic changes. Use only create and style operations.',
    'Every ID you create must begin with the supplied idNamespace followed by a hyphen.',
    'Observe only observationScope.nodeIds; mutate only mutationScopeIds; never target pinnedNodeIds.',
    'Created nodes must be direct children of a mutation-scope node and remain on activeScreenId.',
    'Use objective observations and contextual facts. Phrase inference as a Codesign proposal, never as discovered user intent.',
    'Every evidence ID must be observable and every affected ID must be a mutation target or a created node.',
    'Preserve each pinnedAtomicChanges entry exactly once with preservedFromAtomicChangeId set to its source ID; use fresh namespaced IDs where required.',
    'Use only the registered components, prop values, and style values supplied below. Do not use tools.',
    JSON.stringify(safeContext),
  ].join('\n');

  try {
    // Browser metadata is intentionally not a transport input. A future trusted server-side
    // snapshot resolver may pass a v2 `image` URL or `localImage` path to this method.
    const text = await getCodexClient(commandSetting(), model).proposeCandidate(
      prompt,
      request.signal,
    );
    const candidate = normalizeCandidateBatch(input, run, parseJson(text));
    const response: CandidateGenerationResponse = {
      run,
      candidates: [candidate],
      fallback: false,
      supportedActions: SUPPORTED_ACTIONS,
      visualInputUsed: false,
    };
    return json(response);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown protocol error';
    console.warn('[codesign] Codex candidate fell back:', reason);
    try {
      return json(
        localResponse(
          input,
          runId,
          createdAt,
          true,
          'Codex was unavailable or returned an invalid candidate; deterministic local generation is active.',
        ),
      );
    } catch (fallbackCause) {
      const message =
        fallbackCause instanceof Error ? fallbackCause.message : 'Candidate generation failed';
      return json({ message }, { status: 500 });
    }
  }
}
