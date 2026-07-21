import { validateComponentBinding, validateComponentChild } from '$lib/design-system/registry';
import {
  layoutForNode,
  operationSchema,
  type CanvasSnapshot,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type DesignRevision,
  type Fidelity,
  type OperationRecord,
  type Origin,
  type ProcessEvent,
  type ProcessEventType,
} from './types';

export class OperationError extends Error {}

const clone = <T>(value: T): T => structuredClone(value);
const present = (document: DesignDocument, ids: string[]) => ids.every((id) => document.nodes[id]);

export type ApplyBatchOptions = {
  timestamp?: number;
  transactionId?: string;
  sourceAtomicChangeIds?: string[];
  origin?: Origin;
  revisionStatus?: DesignRevision['status'];
  generationRunId?: string;
  candidateId?: string;
  eventType?: ProcessEventType | false;
};

export function canvasSnapshot(document: DesignDocument): CanvasSnapshot {
  return clone({
    screens: document.screens,
    nodes: document.nodes,
    branches: document.branches,
    activeBranchId: document.activeBranchId,
    activeScreenId: document.activeScreenId,
    entities: document.entities,
    representations: document.representations,
    pinnedNodeIds: document.pinnedNodeIds,
    frameFidelity: document.frameFidelity,
    nodeFidelityOverrides: document.nodeFidelityOverrides,
    projectComponents: document.projectComponents ?? {},
  });
}

export function appendProcessEvent(
  document: DesignDocument,
  event: Omit<ProcessEvent, 'id' | 'sequence'> & { id?: string },
) {
  const sequence = (document.processEvents.at(-1)?.sequence ?? -1) + 1;
  document.processEvents.push({
    ...event,
    id: event.id ?? `event-${sequence}-${event.type}`,
    sequence,
  });
}

function applyStylePatch(
  node: DesignNode,
  patch: Extract<DesignOperation, { type: 'style' }>['patch'],
) {
  const next = { ...node.style };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key as keyof typeof next];
    else Object.assign(next, { [key]: value });
  }
  node.style = next;
  if (!patch.density || !node.componentBinding) return;
  const props = { ...node.componentBinding.props, density: patch.density };
  if (validateComponentBinding(node.componentBinding.componentId, props).ok)
    node.componentBinding = { ...node.componentBinding, props };
}

function summary(operation: DesignOperation) {
  const count = 'targetIds' in operation ? operation.targetIds.length : 1;
  const labels: Record<DesignOperation['type'], string> = {
    create: 'Created node',
    move: `Moved ${count} node${count === 1 ? '' : 's'}`,
    resize: 'Resized node',
    delete: `Deleted ${count} node${count === 1 ? '' : 's'}`,
    repeat: `Grouped repeater · ${count} items`,
    bind: `Bound ${'role' in operation ? operation.role : 'role'}`,
    promote: `Resolved to ${'componentId' in operation ? operation.componentId : 'component'}`,
    style: 'Changed style',
    generalize: `Generalized style · ${count} targets`,
    'update-node': `Updated ${count} node${count === 1 ? '' : 's'}`,
    reparent: `Reparented ${count} node${count === 1 ? '' : 's'}`,
    group: `Grouped ${count} node${count === 1 ? '' : 's'}`,
    ungroup: `Ungrouped ${count} group${count === 1 ? '' : 's'}`,
    reorder: `Reordered ${count} layer${count === 1 ? '' : 's'}`,
    duplicate: `Duplicated ${count} node${count === 1 ? '' : 's'}`,
    'duplicate-screen': 'Duplicated screen',
    'create-branch': 'Created alternative branch',
    'create-project-component': 'Created reusable project component',
  };
  return labels[operation.type];
}

function descendants(document: DesignDocument, ids: string[]) {
  const found = new Set(ids);
  const visit = (id: string) => {
    for (const child of document.nodes[id]?.childIds ?? [])
      if (!found.has(child)) {
        found.add(child);
        visit(child);
      }
  };
  ids.forEach(visit);
  return found;
}

function selectionRoots(document: DesignDocument, ids: string[]) {
  const selected = new Set(ids);
  return ids.filter((id, index) => {
    if (ids.indexOf(id) !== index) return false;
    let parentId = document.nodes[id]?.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodes[parentId]?.parentId;
    }
    return true;
  });
}

function siblingIds(document: DesignDocument, node: DesignNode) {
  if (node.parentId) return document.nodes[node.parentId].childIds;
  const screen = document.screens.find((item) => item.id === node.screenId);
  if (!screen) throw new OperationError('Node screen does not exist');
  return screen.rootIds;
}

function removeFromHierarchy(document: DesignDocument, ids: Set<string>) {
  for (const node of Object.values(document.nodes))
    node.childIds = node.childIds.filter((id) => !ids.has(id));
  for (const screen of document.screens)
    screen.rootIds = screen.rootIds.filter((id) => !ids.has(id));
}

function hierarchyContains(document: DesignDocument, ancestorId: string, nodeId: string) {
  return descendants(document, [ancestorId]).has(nodeId);
}

function hierarchyDepth(document: DesignDocument, nodeId: string) {
  let depth = 0;
  let parentId = document.nodes[nodeId]?.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = document.nodes[parentId]?.parentId;
  }
  return depth;
}

function recomputeAncestorGroupBounds(
  document: DesignDocument,
  nodeIds: string[],
  touch: (node: DesignNode) => void,
) {
  const groupIds = new Set<string>();
  for (const nodeId of nodeIds) {
    let parentId = document.nodes[nodeId]?.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = document.nodes[parentId];
      if (!parent) break;
      if (parent.kind === 'group') groupIds.add(parent.id);
      parentId = parent.parentId;
    }
  }
  for (const groupId of [...groupIds].sort(
    (first, second) => hierarchyDepth(document, second) - hierarchyDepth(document, first),
  )) {
    const group = document.nodes[groupId];
    const children = group.childIds.map((id) => document.nodes[id]).filter(Boolean);
    if (!children.length) continue;
    const left = Math.min(...children.map((child) => child.bounds.x));
    const top = Math.min(...children.map((child) => child.bounds.y));
    const right = Math.max(...children.map((child) => child.bounds.x + child.bounds.width));
    const bottom = Math.max(...children.map((child) => child.bounds.y + child.bounds.height));
    group.bounds = { x: left, y: top, width: right - left, height: bottom - top };
    touch(group);
  }
}

function paddingSides(padding: ReturnType<typeof layoutForNode>['padding']) {
  return typeof padding === 'number'
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : padding;
}

/** Materializes container layout into the canonical absolute bounds used by the canvas. */
function reflowLayouts(document: DesignDocument, touch: (node: DesignNode) => void) {
  const place = (node: DesignNode, x: number, y: number) => {
    const dx = x - node.bounds.x;
    const dy = y - node.bounds.y;
    for (const id of descendants(document, [node.id])) {
      document.nodes[id].bounds.x += dx;
      document.nodes[id].bounds.y += dy;
      touch(document.nodes[id]);
    }
  };
  const visit = (node: DesignNode) => {
    const children = node.childIds
      .map((id) => document.nodes[id])
      .filter((child): child is DesignNode => Boolean(child));
    children.forEach(visit);
    const layout = layoutForNode(node);
    node.layout = layout;
    if (layout.mode === 'none' || !children.length) return;
    const padding = paddingSides(layout.padding);
    const innerWidth = Math.max(0, node.bounds.width - padding.left - padding.right);
    const innerHeight = Math.max(0, node.bounds.height - padding.top - padding.bottom);

    if (layout.mode === 'grid') {
      const columns = Math.max(1, Math.min(layout.gridColumns, children.length));
      const cellWidth = Math.max(1, (innerWidth - layout.gap * (columns - 1)) / columns);
      const rowHeights: number[] = [];
      children.forEach((child, index) => {
        const row = Math.floor(index / columns);
        const childLayout = layoutForNode(child);
        if (childLayout.widthMode === 'fill' || layout.align === 'stretch')
          child.bounds.width = cellWidth;
        rowHeights[row] = Math.max(rowHeights[row] ?? 0, child.bounds.height);
      });
      children.forEach((child, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        place(
          child,
          node.bounds.x + padding.left + column * (cellWidth + layout.gap),
          node.bounds.y +
            padding.top +
            rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) +
            row * layout.gap,
        );
      });
      if (layout.heightMode === 'hug') {
        node.bounds.height =
          padding.top +
          padding.bottom +
          rowHeights.reduce((sum, height) => sum + height, 0) +
          layout.gap * Math.max(0, rowHeights.length - 1);
        touch(node);
      }
      children.forEach(visit);
      return;
    }

    const horizontal = layout.mode === 'horizontal';
    const mainAvailable = horizontal ? innerWidth : innerHeight;
    const fillChildren = children.filter((child) => {
      const childLayout = layoutForNode(child);
      return horizontal ? childLayout.widthMode === 'fill' : childLayout.heightMode === 'fill';
    });
    const fixedMain = children.reduce((sum, child) => {
      if (fillChildren.includes(child)) return sum;
      return sum + (horizontal ? child.bounds.width : child.bounds.height);
    }, 0);
    const regularGap = layout.gap * Math.max(0, children.length - 1);
    const fillSize = fillChildren.length
      ? Math.max(1, (mainAvailable - fixedMain - regularGap) / fillChildren.length)
      : 0;
    for (const child of fillChildren) {
      if (horizontal) child.bounds.width = fillSize;
      else child.bounds.height = fillSize;
    }
    const contentMain =
      children.reduce(
        (sum, child) => sum + (horizontal ? child.bounds.width : child.bounds.height),
        0,
      ) + regularGap;
    let gap = layout.gap;
    let cursor = horizontal ? node.bounds.x + padding.left : node.bounds.y + padding.top;
    const spare = Math.max(0, mainAvailable - contentMain);
    if (layout.justify === 'center') cursor += spare / 2;
    else if (layout.justify === 'end') cursor += spare;
    else if (layout.justify === 'space-between' && children.length > 1)
      gap = layout.gap + spare / (children.length - 1);

    for (const child of children) {
      const childLayout = layoutForNode(child);
      const crossAvailable = horizontal ? innerHeight : innerWidth;
      const stretch = layout.align === 'stretch';
      if (horizontal && (stretch || childLayout.heightMode === 'fill'))
        child.bounds.height = Math.max(1, crossAvailable);
      if (!horizontal && (stretch || childLayout.widthMode === 'fill'))
        child.bounds.width = Math.max(1, crossAvailable);
      const childCross = horizontal ? child.bounds.height : child.bounds.width;
      let cross = horizontal ? node.bounds.y + padding.top : node.bounds.x + padding.left;
      if (layout.align === 'center') cross += (crossAvailable - childCross) / 2;
      else if (layout.align === 'end') cross += crossAvailable - childCross;
      if (horizontal) {
        place(child, cursor, cross);
        cursor += child.bounds.width + gap;
      } else {
        place(child, cross, cursor);
        cursor += child.bounds.height + gap;
      }
    }

    const widest = Math.max(...children.map((child) => child.bounds.width));
    const tallest = Math.max(...children.map((child) => child.bounds.height));
    if (layout.widthMode === 'hug')
      node.bounds.width = padding.left + padding.right + (horizontal ? contentMain : widest);
    if (layout.heightMode === 'hug')
      node.bounds.height = padding.top + padding.bottom + (horizontal ? tallest : contentMain);
    if (layout.widthMode === 'hug' || layout.heightMode === 'hug') touch(node);
    children.forEach(visit);
  };
  for (const screen of document.screens)
    screen.rootIds
      .map((id) => document.nodes[id])
      .filter(Boolean)
      .forEach(visit);
}

function removeNodeMetadata(document: DesignDocument, node: DesignNode) {
  if (node.entityId) {
    for (const representationId of document.entities[node.entityId]?.representationIds ?? [])
      delete document.representations[representationId];
    delete document.entities[node.entityId];
  }
  document.pinnedNodeIds = document.pinnedNodeIds.filter((id) => id !== node.id);
  delete document.nodeFidelityOverrides[node.id];
  delete document.frameFidelity[node.id];
}

function cloneScreen(
  document: DesignDocument,
  sourceScreenId: string,
  targetScreenId: string,
  targetBranchId: string,
  operationId: string,
) {
  const source = document.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new OperationError('Source screen does not exist');
  const sourceNodes = Object.values(document.nodes).filter(
    (node) => node.screenId === sourceScreenId,
  );
  const idMap = Object.fromEntries(
    sourceNodes.map((node, index) => [node.id, `${targetScreenId}-node-${index + 1}`]),
  );
  for (const node of sourceNodes) {
    const cloned = clone(node);
    cloned.id = idMap[node.id];
    cloned.entityId = undefined;
    cloned.screenId = targetScreenId;
    cloned.parentId = node.parentId ? idMap[node.parentId] : undefined;
    cloned.childIds = node.childIds.map((id) => idMap[id]);
    cloned.provenance = { actor: 'agent', operationId };
    if (cloned.projectComponent?.role === 'main')
      cloned.projectComponent = { ...cloned.projectComponent, role: 'instance' };
    document.nodes[cloned.id] = cloned;
  }
  const screen = {
    id: targetScreenId,
    name: `${source.name} ${targetBranchId === source.branchId ? 'copy' : 'alternative'}`,
    rootIds: source.rootIds.map((id) => idMap[id]),
    branchId: targetBranchId,
  };
  document.screens.push(screen);
  return screen;
}

export function validateOperation(document: DesignDocument, candidate: unknown): DesignOperation {
  const parsed = operationSchema.safeParse(candidate);
  if (!parsed.success)
    throw new OperationError(parsed.error.issues[0]?.message ?? 'Invalid operation');
  const operation = parsed.data;
  if (document.operations.some((entry) => entry.id === operation.id))
    throw new OperationError('Operation ID was already applied');
  const targets =
    'targetIds' in operation
      ? operation.targetIds
      : 'targetId' in operation
        ? [operation.targetId]
        : [];
  if (targets.length && !present(document, targets))
    throw new OperationError('One or more targets no longer exist');
  if (operation.actor === 'agent') {
    const affected =
      operation.type === 'delete' || operation.type === 'move'
        ? descendants(document, targets)
        : new Set(targets);
    if (
      [...affected].some(
        (id) => document.pinnedNodeIds.includes(id) || document.nodes[id]?.semantics?.protected,
      )
    )
      throw new OperationError('Agent proposals cannot change pinned nodes');
  }
  if (operation.type === 'create') {
    if (document.nodes[operation.node.id]) throw new OperationError('Node ID already exists');
    if (!document.screens.some((screen) => screen.id === operation.node.screenId))
      throw new OperationError('Node screen does not exist');
    if (operation.node.parentId && !document.nodes[operation.node.parentId])
      throw new OperationError('Parent does not exist');
    if (
      operation.node.parentId &&
      document.nodes[operation.node.parentId].screenId !== operation.node.screenId
    )
      throw new OperationError('Parent and child must share a screen');
    if (operation.node.componentBinding) {
      const binding = validateComponentBinding(
        operation.node.componentBinding.componentId,
        operation.node.componentBinding.props,
      );
      if (!binding.ok) throw new OperationError(binding.error);
    }
    if (operation.node.parentId) {
      const parent = document.nodes[operation.node.parentId];
      if (parent.kind !== 'frame' && parent.kind !== 'group' && parent.kind !== 'instance')
        throw new OperationError('Only frames, groups, and component instances can contain layers');
      if (parent.componentBinding) {
        if (!operation.node.componentBinding)
          throw new OperationError('Component slots only accept registered component parts');
        const relationship = validateComponentChild(
          parent.componentBinding.componentId,
          operation.node.componentBinding.componentId,
          operation.node.componentBinding.slot ?? 'default',
        );
        if (!relationship.ok) throw new OperationError(relationship.error);
      }
    }
  }
  if (operation.type === 'repeat') {
    if (new Set(operation.targetIds).size !== operation.targetIds.length)
      throw new OperationError('Repeater targets must be unique');
    const screens = new Set(operation.targetIds.map((id) => document.nodes[id].screenId));
    if (screens.size !== 1) throw new OperationError('Repeater targets must share a screen');
  }
  if (operation.type === 'update-node') {
    if (
      operation.patch.text !== undefined &&
      targets.some(
        (id) => document.nodes[id].kind !== 'text' && !document.nodes[id].componentBinding,
      )
    )
      throw new OperationError('Text content can only be applied to text or component nodes');
    if (
      operation.patch.clipContent !== undefined &&
      targets.some((id) => document.nodes[id].kind !== 'frame')
    )
      throw new OperationError('Clip content can only be applied to frames');
    if (
      operation.patch.layout?.mode !== undefined &&
      operation.patch.layout.mode !== 'none' &&
      targets.some((id) => !['frame', 'group', 'instance'].includes(document.nodes[id].kind))
    )
      throw new OperationError('Only frames, groups, and component instances support child layout');
  }
  if (operation.type === 'reparent') {
    const roots = selectionRoots(document, operation.targetIds);
    if (new Set(roots.map((id) => document.nodes[id].screenId)).size !== 1)
      throw new OperationError('Reparent targets must share a screen');
    if (operation.parentId) {
      const parent = document.nodes[operation.parentId];
      if (!parent) throw new OperationError('Parent does not exist');
      if (parent.kind !== 'frame' && parent.kind !== 'group' && parent.kind !== 'instance')
        throw new OperationError('Only frames, groups, and component instances can contain layers');
      if (roots.some((id) => document.nodes[id].screenId !== parent.screenId))
        throw new OperationError('Parent and child must share a screen');
      if (roots.some((id) => id === parent.id || hierarchyContains(document, id, parent.id)))
        throw new OperationError('Reparenting would create a hierarchy cycle');
      if (parent.componentBinding) {
        for (const id of roots) {
          const child = document.nodes[id];
          if (!child.componentBinding)
            throw new OperationError('Component slots only accept registered component parts');
          const relationship = validateComponentChild(
            parent.componentBinding.componentId,
            child.componentBinding.componentId,
            child.componentBinding.slot ?? 'default',
          );
          if (!relationship.ok) throw new OperationError(relationship.error);
        }
      }
    }
  }
  if (operation.type === 'group') {
    const roots = selectionRoots(document, operation.targetIds);
    if (roots.length !== operation.targetIds.length)
      throw new OperationError('Group targets must be unique sibling layers');
    if (document.nodes[operation.group.id]) throw new OperationError('Group ID already exists');
    if (operation.group.kind !== 'group')
      throw new OperationError('Group node must have group kind');
    const first = document.nodes[roots[0]];
    if (
      roots.some(
        (id) =>
          document.nodes[id].screenId !== first.screenId ||
          document.nodes[id].parentId !== first.parentId,
      )
    )
      throw new OperationError('Group targets must be siblings on the same screen');
    if (operation.group.screenId !== first.screenId)
      throw new OperationError('Group and children must share a screen');
    if (operation.group.parentId && operation.group.parentId !== first.parentId)
      throw new OperationError('Group parent must match the selected layers');
  }
  if (operation.type === 'ungroup') {
    if (operation.targetIds.some((id) => document.nodes[id].kind !== 'group'))
      throw new OperationError('Only groups can be ungrouped');
    if (
      operation.targetIds.some((id, index) =>
        operation.targetIds.some(
          (otherId, otherIndex) => index !== otherIndex && hierarchyContains(document, id, otherId),
        ),
      )
    )
      throw new OperationError('Nested groups must be ungrouped one level at a time');
  }
  if (operation.type === 'duplicate') {
    const copiedIds = descendants(document, selectionRoots(document, operation.targetIds));
    const mappedSources = Object.keys(operation.idMap);
    if (
      mappedSources.length !== copiedIds.size ||
      mappedSources.some((id) => !copiedIds.has(id)) ||
      [...copiedIds].some((id) => !operation.idMap[id])
    )
      throw new OperationError('Duplicate ID map must cover the complete selected hierarchy');
    const newIds = Object.values(operation.idMap);
    if (new Set(newIds).size !== newIds.length || newIds.some((id) => document.nodes[id]))
      throw new OperationError('Duplicate IDs must be unique and unused');
  }
  if (operation.type === 'promote') {
    const binding = validateComponentBinding(operation.componentId, operation.props);
    if (!binding.ok) throw new OperationError(binding.error);
  }
  if (
    operation.type === 'duplicate-screen' &&
    document.screens.some((screen) => screen.id === operation.screenId)
  )
    throw new OperationError('Screen ID already exists');
  if (
    operation.type === 'create-branch' &&
    document.branches.some((branch) => branch.id === operation.branchId)
  )
    throw new OperationError('Branch ID already exists');
  if (operation.type === 'create-project-component') {
    const target = document.nodes[operation.targetId];
    if (target.kind !== 'frame' && target.kind !== 'group')
      throw new OperationError('Create a component from one selected frame or group');
    if (target.projectComponent)
      throw new OperationError('This frame is already linked to a project component');
    if (document.projectComponents?.[operation.definition.id])
      throw new OperationError('Project component ID already exists');
    if (
      operation.definition.rootId !== operation.targetId ||
      operation.definition.sourceNodeId !== operation.targetId ||
      !operation.definition.nodes[operation.targetId]
    )
      throw new OperationError('Project component definition does not match its source layer');
  }
  return operation;
}

function mutateOperation(document: DesignDocument, operation: DesignOperation) {
  const touch = (node: DesignNode) => {
    node.provenance = { actor: operation.actor, operationId: operation.id };
  };
  switch (operation.type) {
    case 'create': {
      const created = clone(operation.node);
      created.provenance = { actor: operation.actor, operationId: operation.id };
      document.nodes[operation.node.id] = created;
      if (operation.node.parentId) {
        const parent = document.nodes[operation.node.parentId];
        parent.childIds.push(operation.node.id);
        touch(parent);
      } else
        document.screens
          .find((screen) => screen.id === operation.node.screenId)!
          .rootIds.push(operation.node.id);
      break;
    }
    case 'move':
      for (const id of descendants(document, operation.targetIds)) {
        document.nodes[id].bounds.x += operation.dx;
        document.nodes[id].bounds.y += operation.dy;
        touch(document.nodes[id]);
      }
      recomputeAncestorGroupBounds(document, operation.targetIds, touch);
      break;
    case 'resize':
      document.nodes[operation.targetId].bounds = clone(operation.bounds);
      touch(document.nodes[operation.targetId]);
      recomputeAncestorGroupBounds(document, [operation.targetId], touch);
      break;
    case 'delete': {
      const removed = descendants(document, operation.targetIds);
      const removedEntityIds = new Set(
        [...removed]
          .map((id) => document.nodes[id]?.entityId)
          .filter((id): id is string => typeof id === 'string'),
      );
      for (const id of removed) delete document.nodes[id];
      for (const [id, representation] of Object.entries(document.representations))
        if (removedEntityIds.has(representation.entityId)) delete document.representations[id];
      for (const id of removedEntityIds) delete document.entities[id];
      for (const node of Object.values(document.nodes))
        node.childIds = node.childIds.filter((id) => !removed.has(id));
      for (const screen of document.screens)
        screen.rootIds = screen.rootIds.filter((id) => !removed.has(id));
      document.pinnedNodeIds = document.pinnedNodeIds.filter((id) => !removed.has(id));
      for (const id of removed) {
        delete document.nodeFidelityOverrides[id];
        delete document.frameFidelity[id];
      }
      break;
    }
    case 'repeat':
      for (const id of operation.targetIds) {
        document.nodes[id].repeaterId = operation.repeaterId;
        touch(document.nodes[id]);
      }
      break;
    case 'bind':
      // Kept only for applying archived/manual v1 operations during the compatibility window.
      for (const id of operation.targetIds) {
        document.nodes[id].semantics = {
          ...document.nodes[id].semantics,
          role: operation.role,
          commitment: operation.commitment,
        };
        touch(document.nodes[id]);
      }
      break;
    case 'promote':
      for (const id of operation.targetIds) {
        const slot = document.nodes[id].componentBinding?.slot;
        document.nodes[id].componentBinding = {
          componentId: operation.componentId,
          props: clone(operation.props),
          ...(slot ? { slot } : {}),
        };
        document.nodes[id].kind = 'instance';
        touch(document.nodes[id]);
      }
      break;
    case 'style':
      for (const id of operation.targetIds) {
        applyStylePatch(document.nodes[id], operation.patch);
        touch(document.nodes[id]);
      }
      break;
    case 'generalize':
      for (const id of operation.targetIds) {
        applyStylePatch(document.nodes[id], operation.patch);
        touch(document.nodes[id]);
      }
      break;
    case 'update-node':
      for (const id of operation.targetIds) {
        const node = document.nodes[id];
        if (operation.patch.name !== undefined) node.name = operation.patch.name;
        if (operation.patch.text !== undefined) node.text = operation.patch.text;
        if (operation.patch.clipContent !== undefined)
          node.clipContent = operation.patch.clipContent;
        if (operation.patch.layout !== undefined)
          node.layout = { ...layoutForNode(node), ...operation.patch.layout };
        touch(node);
      }
      break;
    case 'reparent': {
      const roots = selectionRoots(document, operation.targetIds);
      const rootSet = new Set(roots);
      const oldParentIds = new Set(
        roots.map((id) => document.nodes[id].parentId).filter((id): id is string => !!id),
      );
      removeFromHierarchy(document, rootSet);
      const destination = operation.parentId
        ? document.nodes[operation.parentId].childIds
        : document.screens.find((screen) => screen.id === document.nodes[roots[0]].screenId)!
            .rootIds;
      const index = Math.min(operation.index ?? destination.length, destination.length);
      destination.splice(index, 0, ...roots);
      for (const id of roots) {
        document.nodes[id].parentId = operation.parentId;
        touch(document.nodes[id]);
      }
      for (const id of oldParentIds) touch(document.nodes[id]);
      if (operation.parentId) touch(document.nodes[operation.parentId]);
      break;
    }
    case 'group': {
      const roots = selectionRoots(document, operation.targetIds);
      const first = document.nodes[roots[0]];
      const sourceStack = siblingIds(document, first);
      const selected = new Set(roots);
      const orderedRoots = sourceStack.filter((id) => selected.has(id));
      const insertionIndex = sourceStack.findIndex((id) => selected.has(id));
      const destinationIndex = sourceStack
        .slice(0, insertionIndex)
        .filter((id) => !selected.has(id)).length;
      const bounds = orderedRoots.map((id) => document.nodes[id].bounds);
      const left = Math.min(...bounds.map((item) => item.x));
      const top = Math.min(...bounds.map((item) => item.y));
      const right = Math.max(...bounds.map((item) => item.x + item.width));
      const bottom = Math.max(...bounds.map((item) => item.y + item.height));
      const group = clone(operation.group);
      group.entityId = undefined;
      group.parentId = first.parentId;
      group.childIds = orderedRoots;
      group.bounds = { x: left, y: top, width: right - left, height: bottom - top };
      group.provenance = { actor: operation.actor, operationId: operation.id };
      document.nodes[group.id] = group;
      const remaining = sourceStack.filter((id) => !selected.has(id));
      sourceStack.splice(0, sourceStack.length, ...remaining);
      sourceStack.splice(destinationIndex, 0, group.id);
      for (const id of orderedRoots) {
        document.nodes[id].parentId = group.id;
        touch(document.nodes[id]);
      }
      if (group.parentId) touch(document.nodes[group.parentId]);
      break;
    }
    case 'ungroup':
      for (const groupId of operation.targetIds) {
        const group = document.nodes[groupId];
        const stack = siblingIds(document, group);
        const index = stack.indexOf(groupId);
        const childIds = [...group.childIds];
        stack.splice(index, 1, ...childIds);
        for (const id of childIds) {
          document.nodes[id].parentId = group.parentId;
          touch(document.nodes[id]);
        }
        if (group.parentId) touch(document.nodes[group.parentId]);
        removeNodeMetadata(document, group);
        delete document.nodes[groupId];
      }
      break;
    case 'reorder': {
      const stacks = new Set<string>();
      for (const id of operation.targetIds) {
        const node = document.nodes[id];
        stacks.add(node.parentId ? `parent:${node.parentId}` : `screen:${node.screenId}`);
      }
      const selected = new Set(operation.targetIds);
      for (const key of stacks) {
        const stack = key.startsWith('parent:')
          ? document.nodes[key.slice(7)].childIds
          : document.screens.find((screen) => screen.id === key.slice(7))!.rootIds;
        const inStack = new Set(stack.filter((id) => selected.has(id)));
        if (operation.direction === 'front')
          stack.splice(
            0,
            stack.length,
            ...stack.filter((id) => !inStack.has(id)),
            ...stack.filter((id) => inStack.has(id)),
          );
        else if (operation.direction === 'back')
          stack.splice(
            0,
            stack.length,
            ...stack.filter((id) => inStack.has(id)),
            ...stack.filter((id) => !inStack.has(id)),
          );
        else if (operation.direction === 'forward') {
          for (let index = stack.length - 2; index >= 0; index--)
            if (inStack.has(stack[index]) && !inStack.has(stack[index + 1]))
              [stack[index], stack[index + 1]] = [stack[index + 1], stack[index]];
        } else
          for (let index = 1; index < stack.length; index++)
            if (inStack.has(stack[index]) && !inStack.has(stack[index - 1]))
              [stack[index], stack[index - 1]] = [stack[index - 1], stack[index]];
      }
      operation.targetIds.forEach((id) => touch(document.nodes[id]));
      break;
    }
    case 'duplicate': {
      const roots = selectionRoots(document, operation.targetIds);
      const copiedIds = descendants(document, roots);
      for (const sourceId of copiedIds) {
        const source = document.nodes[sourceId];
        const duplicate = clone(source);
        duplicate.id = operation.idMap[sourceId];
        duplicate.entityId = undefined;
        duplicate.parentId = source.parentId
          ? (operation.idMap[source.parentId] ?? source.parentId)
          : undefined;
        duplicate.childIds = source.childIds.map((id) => operation.idMap[id]!);
        duplicate.bounds.x += operation.dx;
        duplicate.bounds.y += operation.dy;
        duplicate.provenance = { actor: operation.actor, operationId: operation.id };
        if (duplicate.projectComponent?.role === 'main')
          duplicate.projectComponent = { ...duplicate.projectComponent, role: 'instance' };
        document.nodes[duplicate.id] = duplicate;
        if (document.frameFidelity[sourceId])
          document.frameFidelity[duplicate.id] = document.frameFidelity[sourceId];
        if (document.nodeFidelityOverrides[sourceId])
          document.nodeFidelityOverrides[duplicate.id] = document.nodeFidelityOverrides[sourceId];
      }
      const rootsByStack = new Map<string[], Set<string>>();
      for (const rootId of roots) {
        const stack = siblingIds(document, document.nodes[rootId]);
        const ids = rootsByStack.get(stack) ?? new Set<string>();
        ids.add(rootId);
        rootsByStack.set(stack, ids);
      }
      for (const [stack, ids] of rootsByStack) {
        const next = stack.flatMap((id) => (ids.has(id) ? [id, operation.idMap[id]] : [id]));
        stack.splice(0, stack.length, ...next);
      }
      break;
    }
    case 'duplicate-screen': {
      const source = document.screens.find((screen) => screen.id === operation.sourceScreenId);
      if (!source) throw new OperationError('Source screen does not exist');
      const screen = cloneScreen(
        document,
        source.id,
        operation.screenId,
        source.branchId,
        operation.id,
      );
      document.branches.find((branch) => branch.id === source.branchId)!.screenIds.push(screen.id);
      document.activeScreenId = screen.id;
      break;
    }
    case 'create-branch': {
      const branch = {
        id: operation.branchId,
        name: `Alternative ${document.branches.length}`,
        sourceScreenId: operation.sourceScreenId,
        screenIds: [] as string[],
      };
      const screen = cloneScreen(
        document,
        operation.sourceScreenId,
        `${operation.branchId}-screen`,
        branch.id,
        operation.id,
      );
      branch.screenIds.push(screen.id);
      document.branches.push(branch);
      document.activeBranchId = branch.id;
      document.activeScreenId = screen.id;
      break;
    }
    case 'create-project-component': {
      const target = document.nodes[operation.targetId];
      const definition = clone(operation.definition);
      target.name = definition.name;
      if (definition.nodes[operation.targetId])
        definition.nodes[operation.targetId].name = definition.name;
      document.projectComponents ??= {};
      document.projectComponents[definition.id] = definition;
      target.projectComponent = {
        componentId: definition.id,
        role: 'main',
      };
      touch(target);
      break;
    }
  }
  reflowLayouts(document, touch);
}

function closestFrameFidelity(document: DesignDocument, node: DesignNode): Fidelity | undefined {
  let current: DesignNode | undefined = node;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.kind === 'frame' && document.frameFidelity[current.id])
      return document.frameFidelity[current.id];
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
}

function representationFidelity(document: DesignDocument, node: DesignNode): Fidelity {
  return (
    document.nodeFidelityOverrides[node.id] ??
    closestFrameFidelity(document, node) ??
    (node.componentBinding || node.projectComponent ? 'component' : 'wireframe')
  );
}

function recordEntitiesAndRepresentations(
  document: DesignDocument,
  revisionId: string,
  operations: DesignOperation[],
  origin: Origin,
) {
  for (const node of Object.values(document.nodes)) node.entityId ??= `entity-${node.id}`;
  for (const node of Object.values(document.nodes)) {
    const entityId = node.entityId!;
    const parentEntityId = node.parentId ? document.nodes[node.parentId]?.entityId : undefined;
    document.entities[entityId] ??= {
      id: entityId,
      parentEntityId,
      representationIds: [],
      activeRepresentationId: '',
    };
    document.entities[entityId].parentEntityId = parentEntityId;
  }
  const affectedIds = new Set<string>();
  const operationIds = new Set(operations.map((operation) => operation.id));
  for (const operation of operations) {
    if (operation.type === 'create') affectedIds.add(operation.node.id);
    if ('targetIds' in operation) operation.targetIds.forEach((id) => affectedIds.add(id));
    if ('targetId' in operation) affectedIds.add(operation.targetId);
    if (operation.type === 'generalize') affectedIds.add(operation.sourceId);
    if (operation.type === 'group') affectedIds.add(operation.group.id);
    if (operation.type === 'duplicate')
      Object.values(operation.idMap).forEach((id) => affectedIds.add(id));
  }
  for (const node of Object.values(document.nodes))
    if (operationIds.has(node.provenance.operationId)) affectedIds.add(node.id);
  const affected = Object.values(document.nodes).filter((node) => affectedIds.has(node.id));
  for (const node of affected) {
    const entity = document.entities[node.entityId!];
    const id = `representation-${revisionId}-${node.id}`;
    document.representations[id] = {
      id,
      entityId: entity.id,
      fidelity: representationFidelity(document, node),
      origin,
      revisionId,
      rootNodeIds: [node.id],
    };
    if (!entity.representationIds.includes(id)) entity.representationIds.push(id);
    entity.activeRepresentationId = id;
  }
}

export function applyOperationBatch(
  input: DesignDocument,
  candidates: unknown[],
  options: ApplyBatchOptions = {},
): DesignDocument {
  if (!candidates.length) throw new OperationError('A transaction needs at least one operation');
  const document = clone(input);
  const operations: DesignOperation[] = [];
  const transactionIds = new Set<string>();
  for (const candidate of candidates) {
    const operation = validateOperation(document, candidate);
    if (transactionIds.has(operation.id))
      throw new OperationError('Operation ID was already applied');
    transactionIds.add(operation.id);
    mutateOperation(document, operation);
    operations.push(operation);
  }

  const timestamp = options.timestamp ?? Date.now();
  const transactionId = options.transactionId ?? `transaction-${operations[0].id}`;
  const nextRevision = input.revision + 1;
  let revisionId = `revision-${nextRevision}-${transactionId}`;
  if (document.revisions[revisionId]) revisionId = `${revisionId}-${timestamp}`;
  const origin =
    options.origin ??
    (operations.every((operation) => operation.actor === 'user') ? 'human' : 'ai');
  recordEntitiesAndRepresentations(document, revisionId, operations, origin);
  document.revision = nextRevision;
  document.currentRevisionId = revisionId;

  operations.forEach((operation, index) => {
    const record: OperationRecord = {
      ...operation,
      timestamp,
      summary: summary(operation),
      transactionId,
      sourceAtomicChangeId: options.sourceAtomicChangeIds?.[index],
    } as OperationRecord;
    document.operations.push(record);
  });

  const revision: DesignRevision = {
    id: revisionId,
    parentRevisionId: input.currentRevisionId,
    status: options.revisionStatus ?? 'working',
    origin,
    createdAt: timestamp,
    generationRunId: options.generationRunId,
    candidateId: options.candidateId,
    operationIds: operations.map((operation) => operation.id),
    atomicChangeIds: options.sourceAtomicChangeIds ?? [],
    snapshot: canvasSnapshot(document),
  };
  document.revisions[revisionId] = revision;

  if (options.eventType !== false) {
    appendProcessEvent(document, {
      type: options.eventType ?? 'manual-operation',
      actor: origin === 'human' ? 'user' : 'agent',
      timestamp,
      revisionId,
      generationRunId: options.generationRunId,
      candidateId: options.candidateId,
      details: { transactionId, operationIds: operations.map((operation) => operation.id) },
    });
  }
  return document;
}

export function applyOperation(
  input: DesignDocument,
  candidate: unknown,
  timestamp = Date.now(),
): DesignDocument {
  const parsed = operationSchema.safeParse(candidate);
  const transactionId = parsed.success ? `operation-${parsed.data.id}` : undefined;
  return applyOperationBatch(input, [candidate], { timestamp, transactionId });
}
