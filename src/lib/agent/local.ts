import {
  CANDIDATE_SCHEMA_VERSION,
  type AgentCandidateBatch,
  type GenerationRequest,
} from './candidate';
import type { GenerationRun, StylePatch, StyleProperties } from '$lib/model/types';

const componentProps = (values: Partial<Record<string, unknown>> = {}) => ({
  density: null,
  radius: null,
  interactive: null,
  collapsed: null,
  active: null,
  variant: null,
  size: null,
  tone: null,
  side: null,
  ...values,
});

function style(overrides: Partial<StyleProperties> = {}) {
  return {
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
    ...overrides,
  };
}

function nullablePatch(values: StylePatch) {
  return {
    fill: null,
    stroke: null,
    strokeWidth: null,
    opacity: null,
    radius: null,
    padding: null,
    textColor: null,
    fontSize: null,
    fontWeight: null,
    textAlign: null,
    lineHeight: null,
    density: null,
    ...values,
  };
}

export function localCandidateBatch(
  request: GenerationRequest,
  run: GenerationRun,
): AgentCandidateBatch {
  if (request.action !== 'complete') throw new Error(`${request.action} is not supported locally`);
  const targets = request.mutationScopeIds
    .map((id) => request.document.nodes[id])
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height,
    );
  const target = targets[0];
  if (!target) throw new Error('Select a visible region to complete');

  const candidateId = `${run.id}-candidate-1`;
  const styleChangeId = `${run.id}-change-container`;
  const headingChangeId = `${run.id}-change-heading`;
  const contentChangeId = `${run.id}-change-content`;
  const actionChangeId = `${run.id}-change-action`;
  const inset = Math.min(16, Math.max(4, Math.floor(target.bounds.width / 8)));
  const innerWidth = Math.max(24, target.bounds.width - inset * 2);
  const headingHeight = Math.max(16, Math.min(24, target.bounds.height * 0.18));
  const actionHeight = Math.max(20, Math.min(36, target.bounds.height * 0.22));
  const contentTop = target.bounds.y + inset + headingHeight + 8;
  const contentHeight = Math.max(
    20,
    target.bounds.height - inset * 2 - headingHeight - actionHeight - 20,
  );
  const evidenceIds = [target.id];
  const context = `The selected ${target.name} region is observed together with ${Math.max(0, request.observationScope.nodeIds.length - 1)} nearby node${request.observationScope.nodeIds.length === 2 ? '' : 's'} in the ${request.observationScope.kind} scope.`;
  const pinnedIds = new Map(
    request.pinnedAtomicChanges.map((change, index) => [
      change.id,
      `${run.id}-pinned-change-${index + 1}`,
    ]),
  );
  const pinnedNodeIds = new Map(
    request.pinnedAtomicChanges
      .filter((change) => change.operation.type === 'create')
      .map((change, index) => [
        change.operation.type === 'create' ? change.operation.node.id : '',
        `${run.id}-pinned-node-${index + 1}`,
      ]),
  );
  const pinnedChanges: AgentCandidateBatch['candidate']['atomicChanges'] =
    request.pinnedAtomicChanges.map((change, index) => {
      const operation = change.operation;
      const remappedOperation =
        operation.type === 'style'
          ? {
              id: `${run.id}-pinned-operation-${index + 1}`,
              type: 'style' as const,
              actor: 'agent' as const,
              targetIds: operation.targetIds,
              patch: nullablePatch(operation.patch),
            }
          : operation.type === 'create'
            ? {
                id: `${run.id}-pinned-operation-${index + 1}`,
                type: 'create' as const,
                actor: 'agent' as const,
                node: {
                  id: pinnedNodeIds.get(operation.node.id)!,
                  name: operation.node.name,
                  kind: operation.node.kind,
                  screenId: operation.node.screenId,
                  parentId: operation.node.parentId ?? null,
                  childIds: [],
                  bounds: operation.node.bounds,
                  style: {
                    ...operation.node.style,
                    density: operation.node.style.density ?? null,
                  },
                  text: operation.node.text ?? null,
                  componentBinding: operation.node.componentBinding
                    ? {
                        componentId: operation.node.componentBinding.componentId as
                          | 'Card'
                          | 'DataRow'
                          | 'DataTable'
                          | 'Sidebar'
                          | 'NavItem'
                          | 'Button'
                          | 'Input'
                          | 'Badge'
                          | 'Panel',
                        props: componentProps(operation.node.componentBinding.props),
                      }
                    : null,
                },
              }
            : (() => {
                throw new Error('Pinned operation is not supported by the local backend');
              })();
      return {
        id: pinnedIds.get(change.id)!,
        candidateId,
        preservedFromAtomicChangeId: change.id,
        operation: remappedOperation,
        dependencyIds: change.dependencyIds
          .filter((id) => pinnedIds.has(id))
          .map((id) => pinnedIds.get(id)!),
        trace: {
          ...change.trace,
          affectedNodeIds: change.trace.affectedNodeIds.map((id) => pinnedNodeIds.get(id) ?? id),
        },
      };
    });
  const preservedContainerStyle = pinnedChanges.find(
    (change) => change.operation.type === 'style' && change.operation.targetIds.includes(target.id),
  );
  const containerDependencyIds = preservedContainerStyle
    ? [preservedContainerStyle.id]
    : [styleChangeId];

  const batch: AgentCandidateBatch = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidate: {
      id: candidateId,
      fidelity: request.requestedFidelity,
      atomicChanges: [
        ...pinnedChanges,
        ...(preservedContainerStyle
          ? []
          : [
              {
                id: styleChangeId,
                candidateId,
                preservedFromAtomicChangeId: null,
                operation: {
                  id: `${run.id}-operation-container`,
                  type: 'style' as const,
                  actor: 'agent' as const,
                  targetIds: [target.id],
                  patch: nullablePatch({
                    fill: '#f6f7f9',
                    radius: 12,
                    padding: 16,
                  }),
                },
                dependencyIds: [],
                trace: {
                  observation: `The user bounded ${target.name} as a ${Math.round(target.bounds.width)} by ${Math.round(target.bounds.height)} region.`,
                  context,
                  inference:
                    'Codesign proposes treating the bounded region as a container that can hold a visible continuation; this is a proposal, not a claim about user intent.',
                  proposedChange:
                    'Clarify the selected region with a container surface and spacing rhythm.',
                  evidenceNodeIds: evidenceIds,
                  affectedNodeIds: [target.id],
                },
              },
            ]),
        {
          id: headingChangeId,
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
              parentId: target.id,
              childIds: [],
              bounds: {
                x: target.bounds.x + inset,
                y: target.bounds.y + inset,
                width: innerWidth,
                height: headingHeight,
              },
              style: style({ fill: 'transparent', fontSize: 20 }),
              text: 'Continue from here',
              componentBinding: null,
            },
          },
          dependencyIds: containerDependencyIds,
          trace: {
            observation: `The selected region has ${Math.round(innerWidth)} pixels of usable horizontal space after a bounded inset.`,
            context,
            inference:
              'Codesign proposes a concise heading as one plausible anchor for the continuation.',
            proposedChange: 'Add one native text node near the leading edge of the region.',
            evidenceNodeIds: evidenceIds,
            affectedNodeIds: [`${run.id}-node-heading`],
          },
        },
        {
          id: contentChangeId,
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
              parentId: target.id,
              childIds: [],
              bounds: {
                x: target.bounds.x + inset,
                y: contentTop,
                width: innerWidth,
                height: contentHeight,
              },
              style: style({ fill: '#eef0f3', radius: 8, padding: 12 }),
              text: null,
              componentBinding: null,
            },
          },
          dependencyIds: containerDependencyIds,
          trace: {
            observation: 'The region leaves a larger unresolved area below the proposed heading.',
            context,
            inference:
              'Codesign proposes reserving that negative space for primary content while preserving the chosen outer structure.',
            proposedChange: 'Add one native content surface within the selected mutation boundary.',
            evidenceNodeIds: evidenceIds,
            affectedNodeIds: [`${run.id}-node-content`],
          },
        },
        {
          id: actionChangeId,
          candidateId,
          preservedFromAtomicChangeId: null,
          operation: {
            id: `${run.id}-operation-action`,
            type: 'create',
            actor: 'agent',
            node: {
              id: `${run.id}-node-action`,
              name: 'Candidate action',
              kind:
                request.requestedFidelity === 'component' ||
                request.requestedFidelity === 'visual' ||
                request.requestedFidelity === 'production'
                  ? 'instance'
                  : 'rectangle',
              screenId: target.screenId,
              parentId: target.id,
              childIds: [],
              bounds: {
                x: target.bounds.x + inset,
                y: target.bounds.y + target.bounds.height - inset - actionHeight,
                width: Math.min(innerWidth, 120),
                height: actionHeight,
              },
              style: style({
                fill: '#2563eb',
                radius: 8,
                padding: 8,
                textColor: '#ffffff',
              }),
              text: 'Continue',
              componentBinding:
                request.requestedFidelity === 'component' ||
                request.requestedFidelity === 'visual' ||
                request.requestedFidelity === 'production'
                  ? {
                      componentId: 'Button',
                      props: componentProps({ variant: 'primary', size: 'small' }),
                    }
                  : null,
            },
          },
          dependencyIds: containerDependencyIds,
          trace: {
            observation:
              'The lower edge of the selected region remains available for a compact action.',
            context,
            inference:
              'Codesign proposes one action affordance as an optional completion of the visible hierarchy.',
            proposedChange:
              request.requestedFidelity === 'component' ||
              request.requestedFidelity === 'visual' ||
              request.requestedFidelity === 'production'
                ? 'Create a native Button instance using the registered primary/small contract.'
                : 'Create a native wireframe action primitive.',
            evidenceNodeIds: evidenceIds,
            affectedNodeIds: [`${run.id}-node-action`],
          },
        },
      ],
    },
  };
  const pinnedChangeIds = new Set(pinnedChanges.map((change) => change.id));
  const pinnedCreateNames = new Set(
    pinnedChanges.flatMap((change) =>
      change.operation.type === 'create' ? [change.operation.node.name] : [],
    ),
  );
  batch.candidate.atomicChanges = batch.candidate.atomicChanges.filter(
    (change) =>
      pinnedChangeIds.has(change.id) ||
      change.operation.type !== 'create' ||
      !pinnedCreateNames.has(change.operation.node.name),
  );
  return batch;
}
