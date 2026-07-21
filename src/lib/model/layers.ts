import type { Bounds, DesignDocument, DesignNode } from './types';

type LayerDocument = Pick<DesignDocument, 'screens' | 'nodes'>;

export type LayerRow = {
  node: DesignNode;
  depth: number;
};

function screen(document: LayerDocument, screenId: string) {
  return document.screens.find((item) => item.id === screenId);
}

function visitNode(
  document: LayerDocument,
  nodeId: string,
  depth: number,
  seen: Set<string>,
  rows: LayerRow[],
  reverseChildren: boolean,
  collapsedIds?: ReadonlySet<string>,
) {
  const node = document.nodes[nodeId];
  if (!node || seen.has(nodeId)) return;
  seen.add(nodeId);
  rows.push({ node, depth });
  const childIds = reverseChildren ? [...node.childIds].reverse() : node.childIds;
  if (collapsedIds?.has(nodeId)) {
    const hideDescendants = (childId: string) => {
      const child = document.nodes[childId];
      if (!child || seen.has(childId)) return;
      seen.add(childId);
      child.childIds.forEach(hideDescendants);
    };
    childIds.forEach(hideDescendants);
    return;
  }
  for (const childId of childIds)
    visitNode(document, childId, depth + 1, seen, rows, reverseChildren, collapsedIds);
}

function appendOrphans(
  document: LayerDocument,
  screenId: string,
  seen: Set<string>,
  rows: LayerRow[],
  reverse: boolean,
) {
  const nodes = Object.values(document.nodes).filter((node) => node.screenId === screenId);
  if (reverse) nodes.reverse();
  for (const node of nodes)
    if (!seen.has(node.id)) visitNode(document, node.id, 0, seen, rows, reverse);
}

/** Canvas paint order: containers first, then their children, with newer siblings on top. */
export function orderedScreenNodes(document: LayerDocument, screenId: string): DesignNode[] {
  const seen = new Set<string>();
  const rows: LayerRow[] = [];
  for (const rootId of screen(document, screenId)?.rootIds ?? [])
    visitNode(document, rootId, 0, seen, rows, false);
  appendOrphans(document, screenId, seen, rows, false);
  return rows.map((row) => row.node);
}

/** Layer-panel order: topmost roots first, with each container followed by its child stack. */
export function screenLayerRows(
  document: LayerDocument,
  screenId: string,
  collapsedIds: ReadonlySet<string> = new Set(),
): LayerRow[] {
  const seen = new Set<string>();
  const rows: LayerRow[] = [];
  for (const rootId of [...(screen(document, screenId)?.rootIds ?? [])].reverse())
    visitNode(document, rootId, 0, seen, rows, true, collapsedIds);
  appendOrphans(document, screenId, seen, rows, true);
  return rows;
}

export function descendantNodeIds(
  document: Pick<DesignDocument, 'nodes'>,
  nodeIds: string[],
): string[] {
  const found = new Set<string>();
  const visit = (nodeId: string) => {
    if (found.has(nodeId) || !document.nodes[nodeId]) return;
    found.add(nodeId);
    for (const childId of document.nodes[nodeId].childIds) visit(childId);
  };
  nodeIds.forEach(visit);
  return [...found];
}

/** Whether a layer is a component root or belongs to a component's node tree. */
export function isComponentTreeNode(
  document: Pick<DesignDocument, 'nodes'>,
  nodeId: string,
): boolean {
  const seen = new Set<string>();
  let node: DesignNode | undefined = document.nodes[nodeId];

  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.projectComponent || node.componentBinding) return true;
    node = node.parentId ? document.nodes[node.parentId] : undefined;
  }

  return false;
}

function containsBounds(outer: Bounds, inner: Bounds) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

/** Returns the topmost, deepest frame that fully contains the proposed bounds. */
export function containingFrameForBounds(nodesInPaintOrder: DesignNode[], bounds: Bounds) {
  return [...nodesInPaintOrder]
    .reverse()
    .find((node) => node.kind === 'frame' && containsBounds(node.bounds, bounds));
}

/** Returns the topmost, deepest group or frame that fully contains the proposed bounds. */
export function containingContainerForBounds(nodesInPaintOrder: DesignNode[], bounds: Bounds) {
  return [...nodesInPaintOrder]
    .reverse()
    .find(
      (node) =>
        (node.kind === 'frame' || node.kind === 'group') && containsBounds(node.bounds, bounds),
    );
}
