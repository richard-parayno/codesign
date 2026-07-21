import { descendantNodeIds, orderedScreenNodes } from '$lib/model/layers';
import type { DesignDocument, DesignNode, GenerationTarget } from '$lib/model/types';

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
