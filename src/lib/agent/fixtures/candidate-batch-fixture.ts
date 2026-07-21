import {
  CANDIDATE_SCHEMA_VERSION,
  type AgentCandidateBatch,
  type GenerationRequest,
} from '../candidate';
import type { GenerationRun } from '$lib/model/types';

// A predefined model-response fixture. It exercises the wire contract without acting as a
// production generator or making a live Codex request.
export function candidateBatchFixture(
  request: GenerationRequest,
  run: GenerationRun,
): AgentCandidateBatch {
  const target = request.document.nodes[request.target.focusNodeIds[0]];
  if (!target) throw new Error('The candidate fixture requires its known target node');
  const candidateId = `${run.id}-candidate-1`;
  const styleId = `${run.id}-change-container`;
  const parentId = request.target.mutationScope.insertionParentIds[0] ?? null;
  const innerWidth = Math.max(24, target.bounds.width - 32);
  const trace = (proposedChange: string, affectedNodeIds: string[]) => ({
    observation: 'The selected region is visible in the supplied scene.',
    context: 'The complete observation scope is available to the model.',
    inference: 'The returned continuation is one proposed interpretation.',
    proposedChange,
    evidenceNodeIds: [target.id],
    affectedNodeIds,
  });
  const style = {
    fill: '#ffffff',
    opacity: 1,
    radius: 8,
    padding: 12,
    textColor: '#20242b',
    fontSize: 14,
    fontWeight: 400,
    textAlign: 'left' as const,
    lineHeight: 1.4,
    density: 'comfortable' as const,
  };
  const nullablePatch = {
    fill: '#f6f7f9',
    stroke: null,
    strokeWidth: null,
    opacity: null,
    radius: 12,
    padding: 16,
    textColor: null,
    fontSize: null,
    fontWeight: null,
    textAlign: null,
    lineHeight: null,
    density: null,
  };
  const componentProps = {
    density: null,
    radius: null,
    interactive: null,
    collapsed: null,
    active: null,
    variant: 'secondary' as const,
    size: null,
    tone: null,
    side: null,
  };

  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidate: {
      id: candidateId,
      fidelity: request.requestedFidelity,
      atomicChanges: [
        {
          id: styleId,
          candidateId,
          preservedFromAtomicChangeId: null,
          operation: {
            id: `${run.id}-operation-container`,
            type: 'style',
            actor: 'agent',
            targetIds: [target.id],
            patch: nullablePatch,
          },
          dependencyIds: [],
          trace: trace('Style the selected container.', [target.id]),
        },
        {
          id: `${run.id}-change-heading`,
          candidateId,
          preservedFromAtomicChangeId: null,
          operation: {
            id: `${run.id}-operation-heading`,
            type: 'create',
            actor: 'agent',
            node: {
              id: `${run.id}-node-heading`,
              name: 'Candidate heading',
              kind: 'text',
              screenId: target.screenId,
              parentId,
              childIds: [],
              bounds: {
                x: target.bounds.x + 16,
                y: target.bounds.y + 16,
                width: Math.min(200, innerWidth),
                height: 24,
              },
              style: { ...style, fill: 'transparent', fontSize: 20 },
              text: 'Continue from here',
              componentBinding: null,
            },
          },
          dependencyIds: [styleId],
          trace: trace('Create a heading.', [`${run.id}-node-heading`]),
        },
        {
          id: `${run.id}-change-content`,
          candidateId,
          preservedFromAtomicChangeId: null,
          operation: {
            id: `${run.id}-operation-content`,
            type: 'create',
            actor: 'agent',
            node: {
              id: `${run.id}-node-content`,
              name: 'Candidate content region',
              kind: 'rectangle',
              screenId: target.screenId,
              parentId,
              childIds: [],
              bounds: {
                x: target.bounds.x + 16,
                y: target.bounds.y + 56,
                width: Math.min(240, innerWidth),
                height: 120,
              },
              style: { ...style, fill: '#eef0f3' },
              text: null,
              componentBinding: null,
            },
          },
          dependencyIds: [styleId],
          trace: trace('Create a content region.', [`${run.id}-node-content`]),
        },
        {
          id: `${run.id}-change-action`,
          candidateId,
          preservedFromAtomicChangeId: null,
          operation: {
            id: `${run.id}-operation-action`,
            type: 'create',
            actor: 'agent',
            node: {
              id: `${run.id}-node-action`,
              name: 'Candidate action',
              kind: 'instance',
              screenId: target.screenId,
              parentId,
              childIds: [],
              bounds: {
                x: target.bounds.x + 16,
                y: target.bounds.y + target.bounds.height - 48,
                width: Math.min(120, innerWidth),
                height: 32,
              },
              style: { ...style, fill: '#2563eb', textColor: '#ffffff' },
              text: 'Continue',
              componentBinding: { componentId: 'Button', props: componentProps, slot: null },
            },
          },
          dependencyIds: [styleId],
          trace: trace('Create a Button action.', [`${run.id}-node-action`]),
        },
      ],
    },
  };
}
