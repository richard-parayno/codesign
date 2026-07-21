import type { DesignDocument, DesignNode, ProjectComponentDefinition } from '$lib/model/types';

export class ProjectComponentError extends Error {}

function subtreeIds(nodes: Record<string, DesignNode>, rootId: string) {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const node = nodes[id];
    if (!node || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
    node.childIds.forEach(visit);
  };
  visit(rootId);
  return ordered;
}

export function captureProjectComponent(
  document: Pick<DesignDocument, 'nodes'>,
  rootId: string,
  options: { id: string; name: string; now?: number },
): ProjectComponentDefinition {
  const root = document.nodes[rootId];
  if (!root) throw new ProjectComponentError('The component source no longer exists.');
  if (root.kind !== 'frame' && root.kind !== 'group')
    throw new ProjectComponentError('Create a component from one selected frame or group.');
  const name = options.name.trim().slice(0, 120);
  if (!name) throw new ProjectComponentError('Component name cannot be empty.');
  const ids = subtreeIds(document.nodes, rootId);
  const nodes = Object.fromEntries(
    ids.map((id) => {
      const node = structuredClone(document.nodes[id]);
      if (id === rootId) node.projectComponent = { componentId: options.id, role: 'main' };
      return [id, node];
    }),
  );
  const now = options.now ?? Date.now();
  return {
    id: options.id,
    name,
    rootId,
    sourceNodeId: rootId,
    nodes,
    createdAt: now,
    updatedAt: now,
  };
}

export function currentProjectComponentTemplate(
  document: Pick<DesignDocument, 'nodes'>,
  definition: ProjectComponentDefinition,
) {
  const source = document.nodes[definition.sourceNodeId];
  if (!source || source.projectComponent?.componentId !== definition.id) return definition;
  const captured = captureProjectComponent(document, source.id, {
    id: definition.id,
    name: definition.name,
    now: definition.updatedAt,
  });
  return { ...captured, createdAt: definition.createdAt };
}

export function instantiateProjectComponent(
  definition: ProjectComponentDefinition,
  options: {
    screenId: string;
    origin: { x: number; y: number };
    parentId?: string;
    makeNodeId: () => string;
    makeOperationId: () => string;
  },
) {
  const sourceRoot = definition.nodes[definition.rootId];
  if (!sourceRoot) throw new ProjectComponentError('The component template has no root layer.');
  const orderedSourceIds = subtreeIds(definition.nodes, definition.rootId);
  const ids = new Map(orderedSourceIds.map((id) => [id, options.makeNodeId()]));
  const dx = options.origin.x - sourceRoot.bounds.x;
  const dy = options.origin.y - sourceRoot.bounds.y;
  const nodes = orderedSourceIds.map((sourceId) => {
    const source = definition.nodes[sourceId];
    const isRoot = sourceId === definition.rootId;
    const node = structuredClone(source);
    node.id = ids.get(sourceId)!;
    node.entityId = undefined;
    node.screenId = options.screenId;
    node.parentId = isRoot
      ? options.parentId
      : source.parentId
        ? ids.get(source.parentId)
        : undefined;
    node.childIds = source.childIds.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []));
    node.bounds = { ...source.bounds, x: source.bounds.x + dx, y: source.bounds.y + dy };
    node.provenance = { actor: 'user', operationId: options.makeOperationId() };
    if (isRoot) {
      node.kind = 'instance';
      node.projectComponent = { componentId: definition.id, role: 'instance' };
    }
    return node;
  });
  return { rootId: ids.get(definition.rootId)!, nodes };
}
