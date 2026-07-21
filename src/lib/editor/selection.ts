import type { DesignDocument, DesignNode } from '$lib/model/types';

type SelectionDocument = Pick<DesignDocument, 'nodes'>;
type SelectionModifier = Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/** Ctrl/Cmd-click follows desktop-editor conventions; Shift-click remains supported too. */
export function isAdditiveSelectionModifier(event: SelectionModifier) {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

export function selectionWithTarget(selectedIds: string[], targetId: string, additive: boolean) {
  if (!additive) return [targetId];
  return selectedIds.includes(targetId)
    ? selectedIds.filter((id) => id !== targetId)
    : [...selectedIds, targetId];
}

/**
 * Canvas selection treats groups as cohesive objects. A modifier-assisted deep selection keeps
 * the directly hit node, while the default interaction resolves to the outermost containing group.
 */
export function groupedCanvasSelectionTarget(
  document: SelectionDocument,
  nodeId: string,
  deepSelection = false,
): DesignNode | undefined {
  const hit = document.nodes[nodeId];
  if (!hit || deepSelection) return hit;

  let target = hit;
  let parent = hit.parentId ? document.nodes[hit.parentId] : undefined;
  const seen = new Set([hit.id]);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    if (parent.kind === 'group') target = parent;
    parent = parent.parentId ? document.nodes[parent.parentId] : undefined;
  }
  return target;
}

/**
 * Context menus follow normal group targeting unless the directly hit child is already selected.
 * This lets a selected group own right-clicks over its children while preserving an intentional
 * deep selection.
 */
export function groupedCanvasContextTarget(
  document: SelectionDocument,
  nodeId: string,
  selectedIds: string[],
): DesignNode | undefined {
  return groupedCanvasSelectionTarget(document, nodeId, selectedIds.includes(nodeId));
}
