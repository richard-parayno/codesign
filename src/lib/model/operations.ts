import { validateComponentBinding } from '$lib/design-system/registry';
import {
  operationSchema,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
} from './types';

export class OperationError extends Error {}

const clone = <T>(value: T): T => structuredClone(value);
const present = (document: DesignDocument, ids: string[]) => ids.every((id) => document.nodes[id]);

function summary(operation: DesignOperation) {
  const count = 'targetIds' in operation ? operation.targetIds.length : 1;
  const labels: Record<DesignOperation['type'], string> = {
    create: 'Created node',
    move: `Moved ${count} node${count === 1 ? '' : 's'}`,
    resize: 'Resized node',
    delete: `Deleted ${count} node${count === 1 ? '' : 's'}`,
    repeat: `Confirmed repeater · ${count} items`,
    bind: `Bound ${'role' in operation ? operation.role : 'role'}`,
    transition: 'Connected screen state',
    promote: `Promoted to ${'componentId' in operation ? operation.componentId : 'component'}`,
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
  if (operation.actor === 'agent' && targets.some((id) => document.nodes[id]?.semantics?.protected))
    throw new OperationError('Agent proposals cannot change protected nodes');
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

export function applyOperation(
  input: DesignDocument,
  candidate: unknown,
  timestamp = Date.now(),
): DesignDocument {
  const operation = validateOperation(input, candidate);
  const document = clone(input);
  const touch = (node: DesignNode) => {
    node.provenance = { actor: operation.actor, operationId: operation.id };
  };
  switch (operation.type) {
    case 'create': {
      if (document.nodes[operation.node.id]) throw new OperationError('Node ID already exists');
      if (!document.screens.some((screen) => screen.id === operation.node.screenId))
        throw new OperationError('Node screen does not exist');
      document.nodes[operation.node.id] = clone(operation.node);
      if (operation.node.parentId) {
        const parent = document.nodes[operation.node.parentId];
        if (!parent) throw new OperationError('Parent does not exist');
        parent.childIds.push(operation.node.id);
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
      for (const id of removed) delete document.nodes[id];
      for (const node of Object.values(document.nodes))
        node.childIds = node.childIds.filter((id) => !removed.has(id));
      for (const screen of document.screens)
        screen.rootIds = screen.rootIds.filter((id) => !removed.has(id));
      document.transitions = document.transitions.filter(
        (transition) => !removed.has(transition.sourceNodeId),
      );
      document.hypotheses = document.hypotheses.filter(
        (hypothesis) => !hypothesis.targetIds.some((id) => removed.has(id)),
      );
      break;
    }
    case 'repeat': {
      for (const id of operation.targetIds) {
        document.nodes[id].repeaterId = operation.repeaterId;
        document.nodes[id].semantics = { role: 'record', commitment: 'confirmed' };
        touch(document.nodes[id]);
      }
      document.hypotheses.push({
        id: `hyp-${operation.id}`,
        targetIds: operation.targetIds,
        kind: 'repetition',
        confidence: 0.92,
        status: 'accepted',
        evidence: ['similar geometry', 'aligned spacing'],
      });
      break;
    }
    case 'bind':
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
        document.nodes[id].semantics = {
          role: document.nodes[id].semantics?.role ?? operation.componentId.toLowerCase(),
          commitment: 'confirmed',
        };
        touch(document.nodes[id]);
      }
      break;
    case 'style':
      for (const id of operation.targetIds) {
        document.nodes[id].style = { ...document.nodes[id].style, ...operation.patch };
        touch(document.nodes[id]);
      }
      break;
    case 'generalize':
      for (const id of operation.targetIds) {
        document.nodes[id].style = { ...document.nodes[id].style, ...operation.patch };
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
  document.revision += 1;
  document.operations.push({ ...operation, timestamp, summary: summary(operation) } as never);
  return document;
}
