import type { DesignDocument, DesignNode } from '$lib/model/types';

type SelectionDocument = Pick<DesignDocument, 'nodes'>;
type SelectionModifier = Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/** Ctrl/Cmd-click follows desktop-editor conventions; Shift-click remains supported too. */
export function isAdditiveSelectionModifier(event: SelectionModifier) {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

/** On canvas, Ctrl/Cmd enters a container; Shift is reserved for additive selection. */
export function isCanvasAdditiveSelectionModifier(event: SelectionModifier) {
  return event.shiftKey;
}

export function selectionWithTarget(selectedIds: string[], targetId: string, additive: boolean) {
  if (!additive) return [targetId];
  return selectedIds.includes(targetId)
    ? selectedIds.filter((id) => id !== targetId)
    : [...selectedIds, targetId];
}

/**
 * Canvas selection treats groups and frames as cohesive objects. A modifier-assisted deep
 * selection keeps the directly hit node, while the default interaction resolves to the nearest
 * containing container. Stopping at the nearest container prevents a root screen frame from
 * swallowing interactions with nested groups and frames.
 */
export function groupedCanvasSelectionTarget(
  document: SelectionDocument,
  nodeId: string,
  deepSelection = false,
): DesignNode | undefined {
  const hit = document.nodes[nodeId];
  if (!hit || deepSelection) return hit;
  if (hit.kind === 'group' || hit.kind === 'frame') return hit;

  let parent = hit.parentId ? document.nodes[hit.parentId] : undefined;
  const seen = new Set([hit.id]);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    if (parent.kind === 'group' || parent.kind === 'frame') return parent;
    parent = parent.parentId ? document.nodes[parent.parentId] : undefined;
  }
  return hit;
}

/**
 * An already-selected container keeps ownership when pointer-down lands on one of its descendants.
 * This lets a designer drag a selected frame or group from a full-size background layer without
 * unexpectedly moving that child. Unselected frames still expose their children normally.
 */
export function selectedContainerCanvasTarget(
  document: SelectionDocument,
  nodeId: string,
  selectedIds: string[],
): DesignNode | undefined {
  if (selectedIds.length !== 1) return undefined;
  const selected = document.nodes[selectedIds[0]];
  if (!selected || (selected.kind !== 'group' && selected.kind !== 'frame')) return undefined;

  let current: DesignNode | undefined = document.nodes[nodeId];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.id === selected.id) return selected;
    seen.add(current.id);
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return undefined;
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
