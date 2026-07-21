import type { CanvasSessionHandle } from './harness/contracts';
import type { GenerationRequest } from './candidate';

export const CODESIGN_PROMPT_PAYLOAD_TOKEN = '{{CODESIGN_SESSION_ORIENTATION_JSON}}';

export const CODESIGN_SYSTEM_INSTRUCTIONS = [
  'You are Codesign, an agent operating a constrained visual-design canvas.',
  'Use the supplied canvas tools to inspect the scene and build a copy-on-write candidate. Do not invent scene state or component contracts.',
  'The source scene is immutable. All writes must use candidate.apply_changes and remain inside the server-enforced mutation scope.',
  'Inspect only what you need: start with scene.overview, retrieve exact nodes or component contracts on demand, and request renders when visual evidence is useful.',
  'After each meaningful change, inspect or render the candidate, validate it, repair structured diagnostics, and finish with candidate.submit.',
  'Never expose private reasoning. Put concise, evidence-backed user-facing summaries and evidence node IDs on candidate changes.',
].join('\n');

/** Exact, versioned user prompt sent to the canvas-agent turn. */
export const CODESIGN_COMPLETE_PROMPT_TEMPLATE = [
  'Complete the selected design region as one coherent, editable Codesign candidate.',
  'Preserve the established visual language and do not assume a particular product pattern.',
  'Use scene and component tools for evidence instead of asking for a full scene or catalog dump.',
  'Keep changes atomic, ordered, replayable, and within the mutation scope. Preserve pins.',
  'candidate.apply_changes accepts only create, move, resize, delete, promote, style, update-node, and reparent. Every change requires evidenceNodeIds and summary. For create, put name, kind, parentId, bounds, style, layout, and text directly on operation; never send a nested node or screenId. Codesign assigns missing operation IDs, node IDs, provenance, child IDs, and defaults.',
  'For component, visual, or production fidelity, the edited region must contain at least one compatible installed shadcn-svelte component. Search for relevant components, call components.describe for every component you will use, then instantiate it with kind "instance" and componentBinding { componentId, props } using its exact contract and default size. Use primitives only for bespoke layout and decoration, never as substitutes for a suitable Button, Input, Card, navigation, feedback, or overlay component. Primitive-only candidates at these fidelities fail validation and cannot be submitted.',
  'Do not repeat an identical scene read or render. Reuse its result unless the candidate revision changed.',
  'Use canonical layout and component properties so the result stays editable in Layers, Properties, direct manipulation, undo/redo, persistence, and Svelte projection.',
  'Required loop: inspect, apply a bounded change batch, inspect the candidate preview, validate, repair if needed, then submit.',
  CODESIGN_PROMPT_PAYLOAD_TOKEN,
].join('\n');

const submissionContract = {
  authoritativeCompletion: 'candidate.submit tool result',
  requiredState: 'submitted',
  fields: [
    'sessionId',
    'sourceRevisionId',
    'candidateRevisionId',
    'operations',
    'candidate',
    'traces',
  ],
  note: 'No full candidate JSON is returned as assistant structured output.',
};

export const CODESIGN_PROMPT_TEMPLATE_INSPECTION = {
  id: 'codesign-agent-harness-v4',
  name: 'Complete with Codesign',
  systemInstructions: CODESIGN_SYSTEM_INSTRUCTIONS,
  userTemplate: CODESIGN_COMPLETE_PROMPT_TEMPLATE,
  outputSchema: JSON.stringify(submissionContract, null, 2),
} as const;

function compactOrientation(request: GenerationRequest, session: CanvasSessionHandle) {
  const componentPolicy = ['component', 'visual', 'production'].includes(request.requestedFidelity)
    ? 'shadcn-required: include a compatible manifest component in the edited region; describe every component before binding it; use primitives only for bespoke layout or decoration'
    : 'primitive-first: components are optional at structure or wireframe fidelity';
  return {
    sessionId: session.id,
    sourceRevisionId: session.sourceRevisionId,
    initialCandidateRevisionId: session.candidateRevisionId,
    action: request.action,
    requestedFidelity: request.requestedFidelity,
    componentPolicy,
    focusNodeIds: request.target.focusNodeIds,
    observationScope: {
      kind: request.target.observationScope.kind,
      rootId: request.target.observationScope.rootId ?? null,
      nodeCount: request.target.observationScope.nodeIds.length,
    },
    mutationScope: request.target.mutationScope,
    pinnedNodeIds: request.pinnedNodeIds,
    pinnedChangeIds: request.pinnedAtomicChanges.map((change) => change.id),
    next: 'Call scene.overview. Do not request the full scene or component catalog up front.',
  };
}

export function renderCodesignPrompt(request: GenerationRequest, session: CanvasSessionHandle) {
  return CODESIGN_COMPLETE_PROMPT_TEMPLATE.replace(
    CODESIGN_PROMPT_PAYLOAD_TOKEN,
    JSON.stringify(compactOrientation(request, session)),
  );
}
