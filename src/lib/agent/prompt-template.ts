import {
  PROMPT_VERSION,
  candidateBatchOutputSchema,
  operationToSceneCoordinates,
  type GenerationRequest,
} from './candidate';
import type { SceneContext } from './scene-context';
import type { GenerationRun } from '$lib/model/types';

export const CODESIGN_PROMPT_PAYLOAD_TOKEN = '{{CODESIGN_GENERATION_PAYLOAD_JSON}}';

export const CODESIGN_SYSTEM_INSTRUCTIONS =
  'You are Codesign’s constrained visual-autocomplete adapter. Never use tools, shell, files, or network. Return only the requested structured candidate batch. Treat inferences as proposals, preserve supplied IDs and scopes, use only the registered style/component values in the prompt, and never modify pinned or out-of-scope nodes.';

/**
 * The exact user-prompt template sent for a Codesign completion.
 * Keep the dynamic payload token visible so the contract can be inspected without a live run.
 */
export const CODESIGN_COMPLETE_PROMPT_TEMPLATE = [
  'Complete the supplied design scene with one coherent candidate batch.',
  'Use the visual snapshot and canonical scene context together. Preserve the existing visual language; do not assume a navbar, dashboard, or any particular product pattern.',
  'Return at least three individually useful atomic changes using only create, style, update-node, move, and resize.',
  'For update-node patches, return both name and text; use null for whichever field should remain unchanged.',
  'Every new ID must begin with idNamespace plus a hyphen. Respect mutationScope exactly, never mutate pinned nodes, keep creates inside an allowed insertion parent and editable region, and order nested creates after their parent dependency.',
  'Ground observations in observable node IDs. Phrase inferred intent as a proposal, not as a discovered fact.',
  'Preserve every pinnedAtomicChange exactly once with preservedFromAtomicChangeId and fresh namespaced IDs where required.',
  CODESIGN_PROMPT_PAYLOAD_TOKEN,
].join('\n');

export const CODESIGN_PROMPT_TEMPLATE_INSPECTION = {
  id: PROMPT_VERSION,
  name: 'Complete with Codesign',
  systemInstructions: CODESIGN_SYSTEM_INSTRUCTIONS,
  userTemplate: CODESIGN_COMPLETE_PROMPT_TEMPLATE,
  outputSchema: JSON.stringify(candidateBatchOutputSchema, null, 2),
} as const;

function generationPayload(request: GenerationRequest, run: GenerationRun, context: SceneContext) {
  return {
    idNamespace: run.id,
    pinnedNodeIds: run.pinnedNodeIds,
    pinnedAtomicChanges: request.pinnedAtomicChanges.map((change) => ({
      id: change.id,
      operation: operationToSceneCoordinates(change.operation, context.coordinateSpace.origin),
      dependencyIds: change.dependencyIds,
      trace: change.trace,
    })),
    scene: context,
  };
}

export function renderCodesignPrompt(
  request: GenerationRequest,
  run: GenerationRun,
  context: SceneContext,
) {
  return CODESIGN_COMPLETE_PROMPT_TEMPLATE.replace(
    CODESIGN_PROMPT_PAYLOAD_TOKEN,
    JSON.stringify(generationPayload(request, run, context)),
  );
}
