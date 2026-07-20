import { validateComponentBinding } from '$lib/design-system/registry';
import {
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
    transitions: document.transitions,
    branches: document.branches,
    activeBranchId: document.activeBranchId,
    activeScreenId: document.activeScreenId,
    entities: document.entities,
    representations: document.representations,
    pinnedNodeIds: document.pinnedNodeIds,
    frameFidelity: document.frameFidelity,
    nodeFidelityOverrides: document.nodeFidelityOverrides,
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

function applyStylePatch(node: DesignNode, patch: Partial<DesignNode['style']>) {
  node.style = { ...node.style, ...patch };
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
    transition: 'Connected screen state',
    promote: `Resolved to ${'componentId' in operation ? operation.componentId : 'component'}`,
    style: 'Changed style',
    generalize: `Generalized style · ${count} targets`,
    'duplicate-screen': 'Duplicated screen',
    'create-branch': 'Created alternative branch',
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
      operation.type === 'delete' ? descendants(document, targets) : new Set(targets);
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
  }
  if (operation.type === 'repeat') {
    if (new Set(operation.targetIds).size !== operation.targetIds.length)
      throw new OperationError('Repeater targets must be unique');
    const screens = new Set(operation.targetIds.map((id) => document.nodes[id].screenId));
    if (screens.size !== 1) throw new OperationError('Repeater targets must share a screen');
  }
  if (operation.type === 'promote') {
    const binding = validateComponentBinding(operation.componentId, operation.props);
    if (!binding.ok) throw new OperationError(binding.error);
  }
  if (operation.type === 'transition') {
    if (
      !document.nodes[operation.transition.sourceNodeId] ||
      !document.screens.some((screen) => screen.id === operation.transition.targetScreenId)
    )
      throw new OperationError('Transition endpoints must exist');
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
      for (const id of operation.targetIds) {
        document.nodes[id].bounds.x += operation.dx;
        document.nodes[id].bounds.y += operation.dy;
        touch(document.nodes[id]);
      }
      break;
    case 'resize':
      document.nodes[operation.targetId].bounds = clone(operation.bounds);
      touch(document.nodes[operation.targetId]);
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
      document.transitions = document.transitions.filter(
        (transition) => !removed.has(transition.sourceNodeId),
      );
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
    case 'transition':
      document.transitions.push(clone(operation.transition));
      break;
    case 'promote':
      for (const id of operation.targetIds) {
        document.nodes[id].componentBinding = {
          componentId: operation.componentId,
          props: clone(operation.props),
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
  }
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
    (node.componentBinding ? 'component' : 'wireframe')
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
  for (const operation of operations) {
    if (operation.type === 'create') affectedIds.add(operation.node.id);
    if ('targetIds' in operation) operation.targetIds.forEach((id) => affectedIds.add(id));
    if ('targetId' in operation) affectedIds.add(operation.targetId);
    if (operation.type === 'generalize') affectedIds.add(operation.sourceId);
    if (operation.type === 'transition') affectedIds.add(operation.transition.sourceNodeId);
  }
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
