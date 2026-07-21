import { descendantNodeIds, orderedScreenNodes } from '$lib/model/layers';
import type {
  DesignDocument,
  DesignNode,
  GenerationTarget,
  ObservationScope,
} from '$lib/model/types';

export type CodesignScopeKind = 'selection' | 'same-parent-frame';

export type CodesignEligibility = {
  eligible: boolean;
  selectedNodeIds: string[];
  invalidNodeIds: string[];
  reason?: string;
};

export type CodesignScopeOption = {
  kind: CodesignScopeKind;
  label: string;
  description: string;
  scope?: ObservationScope;
  disabledReason?: string;
};

function ancestorFrames(document: DesignDocument, node: DesignNode) {
  const frames: DesignNode[] = [];
  let current: DesignNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === 'frame') frames.push(current);
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return frames;
}

function commonObservationFrame(document: DesignDocument, nodes: DesignNode[]) {
  if (!nodes.length) return undefined;
  const remaining = nodes
    .slice(1)
    .map((node) => new Set(ancestorFrames(document, node).map((f) => f.id)));
  return ancestorFrames(document, nodes[0]).find((frame) =>
    remaining.every((ids) => ids.has(frame.id)),
  );
}

function closestInsertionParent(document: DesignDocument, node: DesignNode) {
  if (node.kind === 'frame' || node.kind === 'group') return node;
  let parent = node.parentId ? document.nodes[node.parentId] : undefined;
  const seen = new Set<string>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    if (parent.kind === 'frame' || parent.kind === 'group') return parent;
    parent = parent.parentId ? document.nodes[parent.parentId] : undefined;
  }
  return undefined;
}

function activeSelection(document: DesignDocument, selectedNodeIds: readonly string[]) {
  return [...new Set(selectedNodeIds)]
    .map((id) => document.nodes[id])
    .filter((node): node is DesignNode => Boolean(node))
    .filter((node) => node.screenId === document.activeScreenId);
}

function isContainer(node: DesignNode) {
  return node.kind === 'frame' || node.kind === 'group';
}

function containingContainer(document: DesignDocument, node: DesignNode) {
  if (isContainer(node)) return node;
  return closestInsertionParent(document, node);
}

function parentFrames(document: DesignDocument, node: DesignNode) {
  const frames: DesignNode[] = [];
  let current = node.parentId ? document.nodes[node.parentId] : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === 'frame') frames.push(current);
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return frames;
}

/**
 * Codesign only operates on explicit containers, or on layers structurally contained by one.
 * Geometry alone is intentionally insufficient: the layer tree is the generation boundary.
 */
export function inspectCodesignEligibility(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
): CodesignEligibility {
  const uniqueIds = [...new Set(selectedNodeIds)];
  const selectedNodes = activeSelection(document, uniqueIds);
  const selected = new Set(selectedNodes.map((node) => node.id));
  const missingOrInactiveIds = uniqueIds.filter((id) => !selected.has(id));
  const uncontainedIds = selectedNodes
    .filter((node) => !containingContainer(document, node))
    .map((node) => node.id);
  const invalidNodeIds = [...missingOrInactiveIds, ...uncontainedIds];
  if (!uniqueIds.length)
    return {
      eligible: false,
      selectedNodeIds: [],
      invalidNodeIds: [],
      reason: 'Select a group, frame, or a layer inside one to use Codesign.',
    };
  if (missingOrInactiveIds.length)
    return {
      eligible: false,
      selectedNodeIds: selectedNodes.map((node) => node.id),
      invalidNodeIds,
      reason: 'Every Codesign target must exist on the active screen.',
    };
  if (uncontainedIds.length)
    return {
      eligible: false,
      selectedNodeIds: selectedNodes.map((node) => node.id),
      invalidNodeIds,
      reason: 'Every Codesign target must be a group, a frame, or contained in one.',
    };
  return {
    eligible: true,
    selectedNodeIds: selectedNodes.map((node) => node.id),
    invalidNodeIds: [],
  };
}

/** The nearest frame that contains every selected node, excluding a selected frame itself. */
export function commonContainingParentFrame(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
) {
  const nodes = activeSelection(document, selectedNodeIds);
  if (!nodes.length) return undefined;
  const remaining = nodes
    .slice(1)
    .map((node) => new Set(parentFrames(document, node).map((frame) => frame.id)));
  return parentFrames(document, nodes[0]).find((frame) =>
    remaining.every((ids) => ids.has(frame.id)),
  );
}

/** Resolves one of the two user-facing Codesign observation scopes. */
export function deriveCodesignObservationScope(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
  kind: CodesignScopeKind,
): ObservationScope {
  const eligibility = inspectCodesignEligibility(document, selectedNodeIds);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  const screenNodes = orderedScreenNodes(document, document.activeScreenId);
  if (kind === 'selection') {
    const observed = new Set(descendantNodeIds(document, eligibility.selectedNodeIds));
    return {
      kind: 'selection',
      rootId: eligibility.selectedNodeIds.length === 1 ? eligibility.selectedNodeIds[0] : undefined,
      nodeIds: screenNodes.filter((node) => observed.has(node.id)).map((node) => node.id),
    };
  }

  const frame = commonContainingParentFrame(document, eligibility.selectedNodeIds);
  if (!frame) throw new Error('The selection does not share a containing parent frame.');
  const observed = new Set(descendantNodeIds(document, [frame.id]));
  return {
    kind: 'frame',
    rootId: frame.id,
    nodeIds: screenNodes.filter((node) => observed.has(node.id)).map((node) => node.id),
  };
}

/** Builds the two scope choices and their availability for the Codesign menu. */
export function deriveCodesignScopeOptions(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
): CodesignScopeOption[] {
  const eligibility = inspectCodesignEligibility(document, selectedNodeIds);
  if (!eligibility.eligible) {
    const disabledReason = eligibility.reason;
    return [
      {
        kind: 'selection',
        label: 'Selection',
        description: 'Use the selection and all of its children.',
        disabledReason,
      },
      {
        kind: 'same-parent-frame',
        label: 'Same parent frame',
        description: 'Also consider every layer within the same containing frame.',
        disabledReason,
      },
    ];
  }

  const selectionScope = deriveCodesignObservationScope(document, selectedNodeIds, 'selection');
  const frame = commonContainingParentFrame(document, selectedNodeIds);
  return [
    {
      kind: 'selection',
      label: 'Selection',
      description: 'Use the selection and all of its children.',
      scope: selectionScope,
    },
    {
      kind: 'same-parent-frame',
      label: 'Same parent frame',
      description: 'Also consider every layer within the same containing frame.',
      ...(frame
        ? {
            scope: deriveCodesignObservationScope(document, selectedNodeIds, 'same-parent-frame'),
          }
        : { disabledReason: 'The selection does not share a containing parent frame.' }),
    },
  ];
}

/** Strict Codesign target used by the two-option UX. */
export function deriveCodesignGenerationTarget(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
  scopeKind: CodesignScopeKind,
): GenerationTarget {
  const focusNodes = activeSelection(document, selectedNodeIds);
  const observationScope = deriveCodesignObservationScope(document, selectedNodeIds, scopeKind);
  const pinned = new Set(document.pinnedNodeIds);
  const existingNodeIds = descendantNodeIds(
    document,
    focusNodes.map((node) => node.id),
  ).filter((id) => !pinned.has(id));
  const observed = new Set(observationScope.nodeIds);
  const insertionParentIds = [
    ...new Set(
      focusNodes
        .map((node) =>
          scopeKind === 'selection' && !isContainer(node)
            ? undefined
            : closestInsertionParent(document, node)?.id,
        )
        .filter(
          (id): id is string => typeof id === 'string' && observed.has(id) && !pinned.has(id),
        ),
    ),
  ];

  return {
    focusNodeIds: focusNodes.map((node) => node.id),
    observationScope,
    mutationScope: {
      existingNodeIds,
      insertionParentIds,
      regions: focusNodes.map((node) => ({ ...node.bounds })),
      allowCreate: insertionParentIds.length > 0,
    },
  };
}

export function deriveGenerationTarget(
  document: DesignDocument,
  selectedNodeIds: string[],
): GenerationTarget {
  const focusNodes = [...new Set(selectedNodeIds)]
    .map((id) => document.nodes[id])
    .filter((node): node is DesignNode => Boolean(node))
    .filter((node) => node.screenId === document.activeScreenId);
  if (!focusNodes.length) throw new Error('Select an eligible layer on the active screen');

  const observationFrame = commonObservationFrame(document, focusNodes);
  const screenNodes = orderedScreenNodes(document, document.activeScreenId);
  const observedIds = observationFrame
    ? new Set(descendantNodeIds(document, [observationFrame.id]))
    : new Set(screenNodes.map((node) => node.id));
  const observationNodeIds = screenNodes
    .filter((node) => observedIds.has(node.id))
    .map((node) => node.id);
  const pinned = new Set(document.pinnedNodeIds);
  const editableExistingNodeIds = [
    ...new Set(
      focusNodes.flatMap((node) =>
        pinned.has(node.id)
          ? []
          : node.kind === 'frame' || node.kind === 'group'
            ? [...descendantNodeIds(document, [node.id])]
            : [node.id],
      ),
    ),
  ].filter((id) => !pinned.has(id));
  const insertionParentIds = [
    ...new Set(
      focusNodes
        .map((node) => closestInsertionParent(document, node)?.id)
        .filter((id): id is string => typeof id === 'string' && !pinned.has(id)),
    ),
  ];

  return {
    focusNodeIds: focusNodes.map((node) => node.id),
    observationScope: {
      kind: observationFrame ? 'frame' : 'screen',
      rootId: observationFrame?.id,
      nodeIds: observationNodeIds,
    },
    mutationScope: {
      existingNodeIds: editableExistingNodeIds,
      insertionParentIds,
      regions: focusNodes.map((node) => ({ ...node.bounds })),
      allowCreate: insertionParentIds.length > 0 || !observationFrame,
    },
  };
}
