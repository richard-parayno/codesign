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
) {
  const node = document.nodes[nodeId];
  if (!node || seen.has(nodeId)) return;
  seen.add(nodeId);
  rows.push({ node, depth });
  const childIds = reverseChildren ? [...node.childIds].reverse() : node.childIds;
  for (const childId of childIds)
    visitNode(document, childId, depth + 1, seen, rows, reverseChildren);
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
export function screenLayerRows(document: LayerDocument, screenId: string): LayerRow[] {
  const seen = new Set<string>();
  const rows: LayerRow[] = [];
  for (const rootId of [...(screen(document, screenId)?.rootIds ?? [])].reverse())
    visitNode(document, rootId, 0, seen, rows, true);
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
