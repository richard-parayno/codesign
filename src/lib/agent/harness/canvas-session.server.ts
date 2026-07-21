import { randomUUID } from 'node:crypto';
import { validateComponentBinding } from '$lib/design-system/manifest';
import { applyOperation } from '$lib/model/operations';
import {
  boundsSchema,
  defaultLayout,
  defaultStyle,
  layoutForNode,
  operationSchema,
  type Bounds,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
} from '$lib/model/types';
import { z } from 'zod';
import { describeComponents, searchComponents } from './component-tools';
import {
  CANVAS_TOOL_NAMES,
  CanvasSessionError,
  type CandidateChangeInput,
  type CanvasOperationalTrace,
  type CanvasSessionCreateInput,
  type CanvasSessionHandle,
  type CanvasSessionService as CanvasSessionServiceContract,
  type CanvasSessionState,
  type CanvasToolName,
  type SessionDiagnostic,
  type SessionRender,
} from './contracts';
import { RenderSessionService } from './render-session.server';

const DEFAULT_TTL_MS = 15 * 60_000;
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 60 * 60_000;
const MAX_BATCH = 24;
const MAX_PAGE = 100;

const pageSchema = z.object({
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(MAX_PAGE).default(40),
});
const getNodesSchema = pageSchema.extend({
  nodeIds: z.array(z.string().min(1)).min(1).max(100),
  descendants: z.boolean().default(false),
  siblings: z.boolean().default(false),
});
const renderSchema = z.object({
  view: z.enum(['source', 'candidate']).default('candidate'),
  nodeIds: z.array(z.string().min(1)).max(100).optional(),
  bounds: boundsSchema.optional(),
});
const componentSearchSchema = pageSchema.omit({ limit: true }).extend({
  query: z.string().max(120).optional(),
  category: z
    .enum(['actions', 'data-display', 'feedback', 'forms', 'layout', 'navigation', 'overlays'])
    .optional(),
  slots: z.array(z.string().min(1)).max(12).optional(),
  capabilities: z
    .array(z.enum(['editable-content', 'interactive', 'compound', 'children']))
    .max(4)
    .optional(),
  limit: z.number().int().positive().max(30).default(12),
});
const componentDescribeSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(12) });
const candidateStateSchema = pageSchema.extend({
  nodeIds: z.array(z.string().min(1)).max(100).optional(),
  includeTrace: z.boolean().default(false),
});
const changeSchema = z.object({
  operation: operationSchema,
  dependencyIds: z.array(z.string().min(1)).max(MAX_BATCH).default([]),
  evidenceNodeIds: z.array(z.string().min(1)).min(1).max(50),
  summary: z.string().trim().min(1).max(500),
});
const applySchema = z.object({
  candidateRevisionId: z.string().min(1),
  changes: z.array(changeSchema).min(1).max(MAX_BATCH),
});
const emptySchema = z.object({});

type StoredChange = CandidateChangeInput & { appliedAt: number };

type StoredSession = {
  id: string;
  state: CanvasSessionState;
  source: DesignDocument;
  candidate: DesignDocument;
  target: CanvasSessionCreateInput['target'];
  pinnedNodeIds: Set<string>;
  pinnedChangeIds: Set<string>;
  requestedFidelity: CanvasSessionCreateInput['requestedFidelity'];
  action: CanvasSessionCreateInput['action'];
  metadata: { model?: string; backend?: string };
  createdNodeIds: Set<string>;
  changes: StoredChange[];
  traces: CanvasOperationalTrace[];
  renders: SessionRender[];
  validation: SessionDiagnostic[];
  createdAt: number;
  expiresAt: number;
  submittedAt?: number;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalCandidateOperation(session: StoredSession, value: unknown): DesignOperation {
  const canonical = operationSchema.safeParse(value);
  if (canonical.success) return canonical.data;
  const operation = recordValue(value);
  const type = typeof operation?.type === 'string' ? operation.type : 'operation';
  const operationId =
    typeof operation?.id === 'string' ? operation.id : `candidate-${type}-${randomUUID()}`;
  if (operation?.type === 'create') {
    const parentId =
      typeof operation.parentId === 'string'
        ? operation.parentId
        : session.target.mutationScope.insertionParentIds.length === 1
          ? session.target.mutationScope.insertionParentIds[0]
          : undefined;
    const binding = recordValue(operation.componentBinding);
    return operationSchema.parse({
      id: operationId,
      type: 'create',
      actor: 'agent',
      node: {
        id:
          typeof operation.nodeId === 'string'
            ? operation.nodeId
            : `candidate-node-${randomUUID()}`,
        name: operation.name,
        kind: operation.kind,
        screenId: session.source.activeScreenId,
        ...(parentId ? { parentId } : {}),
        childIds: [],
        bounds: operation.bounds,
        style: { ...defaultStyle, ...(recordValue(operation.style) ?? {}) },
        layout: { ...defaultLayout, ...(recordValue(operation.layout) ?? {}) },
        ...(typeof operation.text === 'string' ? { text: operation.text } : {}),
        ...(typeof operation.clipContent === 'boolean'
          ? { clipContent: operation.clipContent }
          : {}),
        ...(binding
          ? {
              componentBinding: {
                ...binding,
                props: recordValue(binding.props) ?? {},
              },
            }
          : {}),
        provenance: { actor: 'agent', operationId },
      },
    });
  }
  return operationSchema.parse({
    ...operation,
    id: operationId,
    actor: 'agent',
    ...(operation?.type === 'promote' && !recordValue(operation.props) ? { props: {} } : {}),
  });
}

function canonicalCandidateApplyInput(session: StoredSession, value: unknown) {
  const input = recordValue(value);
  if (!input || !Array.isArray(input.changes)) return value;
  return {
    ...input,
    changes: input.changes.map((rawChange) => {
      const change = recordValue(rawChange);
      if (!change) return rawChange;
      return {
        ...change,
        operation: canonicalCandidateOperation(session, change.operation),
      };
    }),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function boundedRecord(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 20)
      .map(([key, item]) => [
        key,
        Array.isArray(item)
          ? item.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
          : typeof item === 'string'
            ? item.slice(0, 200)
            : typeof item === 'number' || typeof item === 'boolean'
              ? item
              : '[object]',
      ]),
  ) as Record<string, string | number | boolean | string[]>;
}

function argumentSummary(tool: CanvasToolName, value: unknown) {
  if (
    tool === 'candidate.apply_changes' &&
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { changes?: unknown }).changes)
  ) {
    const changes = (value as { changes: CandidateChangeInput[] }).changes;
    return {
      candidateRevisionId:
        typeof (value as { candidateRevisionId?: unknown }).candidateRevisionId === 'string'
          ? (value as { candidateRevisionId: string }).candidateRevisionId
          : '',
      operationIds: changes
        .map((change) => change.operation?.id)
        .filter(Boolean)
        .slice(0, MAX_BATCH),
      operationTypes: changes
        .map((change) => change.operation?.type)
        .filter(Boolean)
        .slice(0, MAX_BATCH),
      evidenceNodeIds: [
        ...new Set(changes.flatMap((change) => change.evidenceNodeIds ?? [])),
      ].slice(0, 50),
      summaries: changes
        .map((change) => change.summary)
        .filter(Boolean)
        .slice(0, MAX_BATCH),
    };
  }
  return boundedRecord(value);
}

function page<T>(items: T[], cursor: number, limit: number) {
  const values = items.slice(cursor, cursor + limit);
  return {
    items: values,
    total: items.length,
    nextCursor: cursor + values.length < items.length ? cursor + values.length : null,
  };
}

function childrenOf(document: DesignDocument, roots: string[]) {
  const found = new Set<string>();
  const visit = (id: string) => {
    if (found.has(id)) return;
    found.add(id);
    document.nodes[id]?.childIds.forEach(visit);
  };
  roots.forEach(visit);
  return found;
}

function boundsInside(bounds: Bounds, regions: Bounds[]) {
  return regions.some(
    (region) =>
      bounds.x >= region.x &&
      bounds.y >= region.y &&
      bounds.x + bounds.width <= region.x + region.width &&
      bounds.y + bounds.height <= region.y + region.height,
  );
}

function operationTargets(operation: DesignOperation) {
  if ('targetIds' in operation) return operation.targetIds;
  if ('targetId' in operation) return [operation.targetId];
  return [];
}

function nodeSummary(node: DesignNode) {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    screenId: node.screenId,
    parentId: node.parentId ?? null,
    childIds: node.childIds,
    bounds: node.bounds,
    style: node.style,
    layout: layoutForNode(node),
    text: node.text,
    componentBinding: node.componentBinding,
    provenance: node.provenance,
  };
}

function diagnosticsFor(document: DesignDocument) {
  const diagnostics: SessionDiagnostic[] = [];
  for (const [id, node] of Object.entries(document.nodes)) {
    if (id !== node.id)
      diagnostics.push({
        code: 'node-key-mismatch',
        message: `Node key ${id} does not match its ID`,
      });
    if (node.parentId && !document.nodes[node.parentId])
      diagnostics.push({
        code: 'missing-parent',
        message: `Node ${id} references missing parent ${node.parentId}`,
        nodeIds: [id],
        repair: 'Create the parent first or choose an allowed existing parent.',
      });
    for (const childId of node.childIds)
      if (document.nodes[childId]?.parentId !== id)
        diagnostics.push({
          code: 'invalid-child-link',
          message: `Node ${id} has an inconsistent child link to ${childId}`,
          nodeIds: [id, childId],
        });
    if (node.componentBinding) {
      const binding = validateComponentBinding(
        node.componentBinding.componentId,
        node.componentBinding.props,
      );
      if (!binding.ok)
        diagnostics.push({
          code: 'invalid-component',
          message: binding.error,
          nodeIds: [id],
          repair: 'Consult components.describe and use the declared component contract.',
        });
    }
    const seen = new Set([id]);
    let parentId = node.parentId;
    while (parentId) {
      if (seen.has(parentId)) {
        diagnostics.push({
          code: 'hierarchy-cycle',
          message: `Hierarchy cycle includes ${id}`,
          nodeIds: [...seen],
        });
        break;
      }
      seen.add(parentId);
      parentId = document.nodes[parentId]?.parentId;
    }
  }
  return diagnostics;
}

function assertCreate(
  session: StoredSession,
  operation: Extract<DesignOperation, { type: 'create' }>,
  dependencies: Set<string>,
) {
  const node = operation.node;
  if (!session.target.mutationScope.allowCreate)
    throw new CanvasSessionError('create-forbidden', 'Creation is disabled for this target');
  if (session.source.nodes[node.id] || session.createdNodeIds.has(node.id))
    throw new CanvasSessionError('node-id-collision', `Node ID ${node.id} already exists`);
  if (node.screenId !== session.source.activeScreenId)
    throw new CanvasSessionError('scope-violation', 'Created nodes must stay on the active screen');
  if (node.provenance.actor !== 'agent' || node.provenance.operationId !== operation.id)
    throw new CanvasSessionError(
      'invalid-provenance',
      'Created-node provenance must identify its agent creation operation',
    );
  if (node.childIds.length)
    throw new CanvasSessionError(
      'unstaged-children',
      'Created nodes cannot claim children before those children are created',
    );
  if (!boundsInside(node.bounds, session.target.mutationScope.regions))
    throw new CanvasSessionError('region-violation', 'Created node exceeds the editable region');
  if (node.parentId) {
    const createdParent = session.createdNodeIds.has(node.parentId);
    if (!createdParent && !session.target.mutationScope.insertionParentIds.includes(node.parentId))
      throw new CanvasSessionError(
        'insertion-parent-violation',
        `Parent ${node.parentId} is outside the insertion scope`,
      );
    if (session.pinnedNodeIds.has(node.parentId))
      throw new CanvasSessionError('pinned-node', `Parent ${node.parentId} is pinned`);
    if (createdParent) {
      const creation = session.changes.find(
        (change) =>
          change.operation.type === 'create' && change.operation.node.id === node.parentId,
      );
      if (!creation || !dependencies.has(creation.operation.id))
        throw new CanvasSessionError(
          'missing-dependency',
          'Nested creation must depend on its parent creation operation',
          [
            {
              code: 'missing-dependency',
              message: `Add ${creation?.operation.id ?? 'the parent operation'} to dependencyIds`,
              nodeIds: [node.id, node.parentId],
            },
          ],
        );
    }
  } else if (
    session.target.mutationScope.insertionParentIds.length ||
    session.target.observationScope.kind !== 'screen'
  ) {
    throw new CanvasSessionError('root-create-forbidden', 'A root node cannot be created here');
  }
}

function validateScopedOperation(
  session: StoredSession,
  operation: DesignOperation,
  dependencyIds: string[],
) {
  if (operation.actor !== 'agent')
    throw new CanvasSessionError('invalid-actor', 'Candidate operations must be agent-authored');
  if (
    !['create', 'move', 'resize', 'delete', 'style', 'update-node', 'reparent', 'promote'].includes(
      operation.type,
    )
  )
    throw new CanvasSessionError(
      'unsupported-operation',
      `${operation.type} is not available to candidate sessions`,
    );
  const knownDependencies = new Set(session.changes.map((change) => change.operation.id));
  if (dependencyIds.some((id) => !knownDependencies.has(id)))
    throw new CanvasSessionError(
      'missing-dependency',
      'A candidate dependency has not been applied',
    );
  if (operation.type === 'create') {
    assertCreate(session, operation, new Set(dependencyIds));
    return;
  }
  const targets = operationTargets(operation);
  const mutable = new Set([
    ...session.target.mutationScope.existingNodeIds,
    ...session.createdNodeIds,
  ]);
  if (targets.some((id) => !mutable.has(id)))
    throw new CanvasSessionError(
      'scope-violation',
      `${operation.type} targets a node outside the mutation scope`,
      [
        {
          code: 'scope-violation',
          message: 'Only editable existing nodes and nodes created in this session may be changed.',
          nodeIds: targets.filter((id) => !mutable.has(id)),
          repair: 'Inspect scene.overview and restrict target IDs to mutationScope.',
        },
      ],
    );
  for (const id of targets) {
    if (!session.createdNodeIds.has(id)) continue;
    const creation = session.changes.find(
      (change) => change.operation.type === 'create' && change.operation.node.id === id,
    );
    if (!creation || !dependencyIds.includes(creation.operation.id))
      throw new CanvasSessionError(
        'missing-dependency',
        `Mutation of generated node ${id} must depend on its creation operation`,
        [
          {
            code: 'missing-dependency',
            message: `Add ${creation?.operation.id ?? 'the creation operation'} to dependencyIds`,
            nodeIds: [id],
          },
        ],
      );
  }
  const affected = ['move', 'delete'].includes(operation.type)
    ? childrenOf(session.candidate, targets)
    : new Set(targets);
  if ([...affected].some((id) => session.pinnedNodeIds.has(id)))
    throw new CanvasSessionError('pinned-node', 'Candidate operation would change a pinned node');
  if (
    operation.type === 'resize' &&
    !boundsInside(operation.bounds, session.target.mutationScope.regions)
  )
    throw new CanvasSessionError('region-violation', 'Resize exceeds the editable region');
  if (operation.type === 'move')
    for (const id of targets) {
      const node = session.candidate.nodes[id];
      if (
        node &&
        !boundsInside(
          { ...node.bounds, x: node.bounds.x + operation.dx, y: node.bounds.y + operation.dy },
          session.target.mutationScope.regions,
        )
      )
        throw new CanvasSessionError('region-violation', 'Move exceeds the editable region');
    }
  if (operation.type === 'reparent' && operation.parentId) {
    const parentCreated = session.createdNodeIds.has(operation.parentId);
    if (
      !parentCreated &&
      !session.target.mutationScope.insertionParentIds.includes(operation.parentId)
    )
      throw new CanvasSessionError(
        'insertion-parent-violation',
        'Reparent destination is forbidden',
      );
    if (parentCreated) {
      const creation = session.changes.find(
        (change) =>
          change.operation.type === 'create' && change.operation.node.id === operation.parentId,
      );
      if (!creation || !dependencyIds.includes(creation.operation.id))
        throw new CanvasSessionError(
          'missing-dependency',
          'Reparenting into a created parent requires its creation dependency',
        );
    }
  }
}

function differs(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function nodeDiffers(left: DesignNode | undefined, right: DesignNode | undefined) {
  if (!left || !right) return left !== right;
  const leftComparable = clone(left);
  const rightComparable = clone(right);
  // applyOperation lazily initializes stable entity identity for every legacy node. That metadata
  // is not a canvas mutation and must not make an otherwise scoped operation fail.
  delete leftComparable.entityId;
  delete rightComparable.entityId;
  leftComparable.layout = layoutForNode(leftComparable);
  rightComparable.layout = layoutForNode(rightComparable);
  return differs(leftComparable, rightComparable);
}

function onlyStructuralParentFieldsChanged(before: DesignNode, after: DesignNode) {
  const beforeComparable = clone(before);
  const afterComparable = clone(after);
  beforeComparable.childIds = [];
  afterComparable.childIds = [];
  beforeComparable.provenance = { actor: 'user', operationId: 'scope-check' };
  afterComparable.provenance = { actor: 'user', operationId: 'scope-check' };
  return !differs(beforeComparable, afterComparable);
}

/** Reject reducer side effects that escape the explicit write authority of the session. */
function validateIndirectMutations(
  session: StoredSession,
  before: DesignDocument,
  after: DesignDocument,
  operation: DesignOperation,
) {
  const explicitTargets = operation.type === 'create' ? [] : operationTargets(operation);
  const authorizedSubtree = ['move', 'delete'].includes(operation.type)
    ? childrenOf(before, explicitTargets)
    : new Set<string>();
  const mutable = new Set([
    ...session.target.mutationScope.existingNodeIds,
    ...session.createdNodeIds,
    ...authorizedSubtree,
    ...(operation.type === 'create' ? [operation.node.id] : []),
  ]);
  const structuralParents = new Set(session.target.mutationScope.insertionParentIds);
  const changedIds = new Set<string>();
  for (const id of new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]))
    if (nodeDiffers(before.nodes[id], after.nodes[id])) changedIds.add(id);

  const forbidden = [...changedIds].filter((id) => {
    if (mutable.has(id)) return false;
    const beforeNode = before.nodes[id];
    const afterNode = after.nodes[id];
    return !(
      structuralParents.has(id) &&
      beforeNode &&
      afterNode &&
      onlyStructuralParentFieldsChanged(beforeNode, afterNode)
    );
  });
  if (forbidden.length)
    throw new CanvasSessionError(
      'indirect-scope-violation',
      'Candidate operation would indirectly change nodes outside the mutation scope',
      [
        {
          code: 'indirect-scope-violation',
          message: 'Layout reflow or ancestor geometry would change nodes without write authority.',
          nodeIds: forbidden.slice(0, 50),
          repair:
            'Restrict the operation or ask the designer to select the affected container and siblings.',
        },
      ],
    );
  const changedPins = [...session.pinnedNodeIds].filter((id) =>
    nodeDiffers(before.nodes[id], after.nodes[id]),
  );
  if (changedPins.length)
    throw new CanvasSessionError(
      'pinned-node',
      'Candidate operation would indirectly change a pinned node',
      [
        {
          code: 'pinned-node',
          message: 'Pinned node design state must remain unchanged in the candidate.',
          nodeIds: changedPins,
        },
      ],
    );
}

export class CanvasSessionService implements CanvasSessionServiceContract {
  private readonly sessions = new Map<string, StoredSession>();
  private disposed = false;

  constructor(
    private readonly renders = new RenderSessionService(),
    private readonly now: () => number = Date.now,
  ) {}

  async createSession(input: CanvasSessionCreateInput): Promise<CanvasSessionHandle> {
    if (this.disposed)
      throw new CanvasSessionError('service-disposed', 'Canvas session service is disposed');
    const source = clone(input.document);
    const observed = new Set(input.target.observationScope.nodeIds);
    const known = (id: string) => Boolean(source.nodes[id]);
    if (
      !input.target.focusNodeIds.length ||
      input.target.focusNodeIds.some((id) => !observed.has(id))
    )
      throw new CanvasSessionError(
        'invalid-target',
        'Focus nodes must be in the observation scope',
      );
    if ([...observed].some((id) => !known(id)))
      throw new CanvasSessionError('invalid-target', 'Observation scope contains an unknown node');
    if (input.target.mutationScope.existingNodeIds.some((id) => !observed.has(id) || !known(id)))
      throw new CanvasSessionError('invalid-target', 'Mutation nodes must be observable');
    if (input.target.mutationScope.insertionParentIds.some((id) => !observed.has(id) || !known(id)))
      throw new CanvasSessionError('invalid-target', 'Insertion parents must be observable');
    const pinnedNodeIds = new Set([...source.pinnedNodeIds, ...(input.pinnedNodeIds ?? [])]);
    if ([...pinnedNodeIds].some((id) => !known(id)))
      throw new CanvasSessionError('invalid-target', 'Pinned scope contains an unknown node');
    if (input.target.mutationScope.existingNodeIds.some((id) => pinnedNodeIds.has(id)))
      throw new CanvasSessionError('invalid-target', 'Pinned nodes cannot be editable');
    if (input.target.mutationScope.insertionParentIds.some((id) => pinnedNodeIds.has(id)))
      throw new CanvasSessionError('invalid-target', 'Pinned nodes cannot be insertion parents');
    if (!input.target.mutationScope.regions.length)
      throw new CanvasSessionError('invalid-target', 'At least one editable region is required');
    const createdAt = this.now();
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, input.ttlMs ?? DEFAULT_TTL_MS));
    const id = `canvas-${randomUUID()}`;
    const session: StoredSession = {
      id,
      state: 'active',
      source,
      candidate: clone(source),
      target: clone(input.target),
      pinnedNodeIds,
      pinnedChangeIds: new Set(),
      requestedFidelity: input.requestedFidelity,
      action: input.action,
      metadata: { model: input.model, backend: input.backend },
      createdNodeIds: new Set(),
      changes: [],
      traces: [],
      renders: [],
      validation: [],
      createdAt,
      expiresAt: createdAt + ttlMs,
    };
    this.sessions.set(id, session);
    this.trace(
      session,
      'session.create',
      createdAt,
      {
        action: input.action,
        requestedFidelity: input.requestedFidelity,
        focusNodeIds: input.target.focusNodeIds,
        observationMode: input.target.observationScope.kind,
      },
      { state: 'active' },
    );
    if (input.seedChanges?.length) {
      try {
        this.applyChanges(
          session,
          applySchema.parse({
            candidateRevisionId: session.candidate.currentRevisionId,
            changes: input.seedChanges,
          }),
        );
      } catch (cause) {
        this.sessions.delete(id);
        throw cause;
      }
    }
    session.pinnedChangeIds = new Set(input.pinnedChangeIds ?? []);
    if (
      [...session.pinnedChangeIds].some(
        (changeId) => !session.changes.some((change) => change.operation.id === changeId),
      )
    ) {
      this.sessions.delete(id);
      throw new CanvasSessionError(
        'invalid-target',
        'Pinned changes must be supplied as candidate seed changes',
      );
    }
    return this.handle(session);
  }

  async dispatch(sessionId: string, toolName: CanvasToolName, args: unknown): Promise<unknown> {
    if (!CANVAS_TOOL_NAMES.includes(toolName))
      throw new CanvasSessionError('unknown-tool', `Unknown canvas tool: ${toolName}`);
    const session = this.requireActive(sessionId, toolName === 'candidate.get_state');
    const startedAt = this.now();
    try {
      let result: unknown;
      if (toolName === 'scene.overview') result = this.overview(session, pageSchema.parse(args));
      else if (toolName === 'scene.get_nodes')
        result = this.getNodes(session, getNodesSchema.parse(args));
      else if (toolName === 'scene.render')
        result = await this.render(session, renderSchema.parse(args));
      else if (toolName === 'components.search')
        result = searchComponents(componentSearchSchema.parse(args));
      else if (toolName === 'components.describe')
        result = describeComponents(componentDescribeSchema.parse(args).ids);
      else if (toolName === 'candidate.get_state')
        result = this.candidateState(session, candidateStateSchema.parse(args));
      else if (toolName === 'candidate.apply_changes')
        result = this.applyChanges(
          session,
          applySchema.parse(canonicalCandidateApplyInput(session, args)),
        );
      else if (toolName === 'candidate.validate') {
        emptySchema.parse(args);
        result = this.validate(session);
      } else {
        emptySchema.parse(args);
        result = await this.submit(session);
      }
      const renderHash =
        result && typeof result === 'object' && 'sha256' in result
          ? String((result as { sha256: unknown }).sha256)
          : undefined;
      this.trace(
        session,
        toolName,
        startedAt,
        argumentSummary(toolName, args),
        boundedRecord(result),
        renderHash,
      );
      if (
        toolName === 'candidate.submit' &&
        result &&
        typeof result === 'object' &&
        'traces' in result
      )
        (result as { traces: CanvasOperationalTrace[] }).traces = clone(session.traces);
      return result;
    } catch (cause) {
      const error =
        cause instanceof CanvasSessionError
          ? cause
          : cause instanceof z.ZodError
            ? new CanvasSessionError(
                'invalid-arguments',
                cause.issues[0]?.message ?? 'Invalid tool arguments',
              )
            : new CanvasSessionError(
                'tool-failed',
                cause instanceof Error ? cause.message : 'Canvas tool failed',
              );
      this.trace(session, toolName, startedAt, argumentSummary(toolName, args), {
        ok: false,
        code: error.code,
      });
      throw error;
    }
  }

  async cancelSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.state = 'cancelled';
    this.trace(session, 'session.cancel', this.now(), {}, { state: 'cancelled' });
    await this.renders.cleanupSession(id);
    this.sessions.delete(id);
    return true;
  }

  async cleanupExpired() {
    const now = this.now();
    const expired = [...this.sessions.values()].filter((session) => session.expiresAt <= now);
    for (const session of expired) {
      session.state = 'expired';
      this.trace(session, 'session.cleanup', now, {}, { state: 'expired' });
      await this.renders.cleanupSession(session.id);
      this.sessions.delete(session.id);
    }
    return expired.length;
  }

  async dispose() {
    this.disposed = true;
    await this.renders.dispose();
    this.sessions.clear();
  }

  private handle(session: StoredSession): CanvasSessionHandle {
    return {
      id: session.id,
      state: session.state,
      sourceRevisionId: session.source.currentRevisionId,
      candidateRevisionId: session.candidate.currentRevisionId,
      expiresAt: session.expiresAt,
    };
  }

  private requireActive(id: string, allowSubmitted = false) {
    const session = this.sessions.get(id);
    if (!session)
      throw new CanvasSessionError('session-not-found', `Canvas session ${id} was not found`);
    if (session.expiresAt <= this.now()) {
      void this.cancelSession(id);
      throw new CanvasSessionError('session-expired', `Canvas session ${id} expired`);
    }
    if (session.state !== 'active' && !(allowSubmitted && session.state === 'submitted'))
      throw new CanvasSessionError('session-not-active', `Canvas session is ${session.state}`);
    return session;
  }

  private overview(session: StoredSession, input: z.infer<typeof pageSchema>) {
    const observed = new Set(session.target.observationScope.nodeIds);
    const nodes = session.target.observationScope.nodeIds
      .map((id) => session.source.nodes[id])
      .filter((node): node is DesignNode => Boolean(node))
      .map((node) => ({
        id: node.id,
        name: node.name,
        kind: node.kind,
        parentId: node.parentId && observed.has(node.parentId) ? node.parentId : null,
        childCount: node.childIds.filter((id) => observed.has(id)).length,
        bounds: node.bounds,
        componentId: node.componentBinding?.componentId,
      }));
    return {
      sourceRevisionId: session.source.currentRevisionId,
      candidateRevisionId: session.candidate.currentRevisionId,
      action: session.action,
      fidelity: session.requestedFidelity,
      focusNodeIds: session.target.focusNodeIds,
      observationScope: session.target.observationScope,
      mutationScope: session.target.mutationScope,
      pinnedNodeIds: [...session.pinnedNodeIds],
      pinnedChangeIds: [...session.pinnedChangeIds],
      styleSummary: {
        fills: [...new Set(nodes.map((node) => session.source.nodes[node.id].style.fill))].slice(
          0,
          12,
        ),
        componentIds: [
          ...new Set(nodes.flatMap((node) => (node.componentId ? [node.componentId] : []))),
        ].slice(0, 20),
      },
      hierarchy: page(nodes, input.cursor, input.limit),
    };
  }

  private getNodes(session: StoredSession, input: z.infer<typeof getNodesSchema>) {
    const observed = new Set(session.target.observationScope.nodeIds);
    const selected = new Set<string>();
    for (const id of input.nodeIds) {
      if (!observed.has(id))
        throw new CanvasSessionError('observation-scope', `Node ${id} is not observable`);
      selected.add(id);
      if (input.descendants)
        for (const descendant of childrenOf(session.source, [id]))
          if (observed.has(descendant)) selected.add(descendant);
      if (input.siblings) {
        const node = session.source.nodes[id];
        const siblings = node.parentId
          ? session.source.nodes[node.parentId]?.childIds
          : session.source.screens.find((screen) => screen.id === node.screenId)?.rootIds;
        siblings?.forEach((sibling) => observed.has(sibling) && selected.add(sibling));
      }
    }
    return page(
      [...selected].map((id) => nodeSummary(session.source.nodes[id])),
      input.cursor,
      input.limit,
    );
  }

  private async render(session: StoredSession, input: z.infer<typeof renderSchema>) {
    const document = input.view === 'source' ? session.source : session.candidate;
    const observed = new Set(session.target.observationScope.nodeIds);
    const requestedNodeIds = input.nodeIds?.length
      ? input.nodeIds
      : input.view === 'source'
        ? session.target.observationScope.nodeIds
        : [...session.target.observationScope.nodeIds, ...session.createdNodeIds];
    if (requestedNodeIds.some((id) => !observed.has(id) && !session.createdNodeIds.has(id)))
      throw new CanvasSessionError(
        'observation-scope',
        'Render includes a node outside the session scene',
      );
    const nodeIds = [...childrenOf(document, requestedNodeIds)];
    const render = await this.renders.render({
      sessionId: session.id,
      document,
      view: input.view,
      nodeIds,
      bounds: input.bounds,
    });
    if (!session.renders.some((candidate) => candidate.id === render.id))
      session.renders.push(render);
    return render;
  }

  private candidateState(session: StoredSession, input: z.infer<typeof candidateStateSchema>) {
    const defaultIds = [...session.target.mutationScope.existingNodeIds, ...session.createdNodeIds];
    const ids = input.nodeIds?.length ? input.nodeIds : defaultIds;
    if (ids.some((id) => !session.candidate.nodes[id]))
      throw new CanvasSessionError('node-not-found', 'Candidate slice contains an unknown node');
    return {
      ...this.handle(session),
      pinnedChangeIds: [...session.pinnedChangeIds],
      operations: page(
        session.changes.map((change) => ({
          id: change.operation.id,
          type: change.operation.type,
          dependencyIds: change.dependencyIds ?? [],
          evidenceNodeIds: change.evidenceNodeIds,
          summary: change.summary,
        })),
        input.cursor,
        input.limit,
      ),
      nodes: page(
        ids.map((id) => nodeSummary(session.candidate.nodes[id])),
        input.cursor,
        input.limit,
      ),
      validation: session.validation,
      traces: input.includeTrace
        ? page(session.traces, input.cursor, Math.min(input.limit, 50))
        : undefined,
    };
  }

  private applyChanges(session: StoredSession, input: z.infer<typeof applySchema>) {
    if (input.candidateRevisionId !== session.candidate.currentRevisionId)
      throw new CanvasSessionError(
        'stale-revision',
        `Candidate revision ${input.candidateRevisionId} is stale; current revision is ${session.candidate.currentRevisionId}`,
        [
          {
            code: 'stale-revision',
            message: 'The candidate changed after this mutation batch was prepared.',
            path: 'candidateRevisionId',
            repair:
              'Call candidate.get_state, rebuild the change against its candidateRevisionId, and retry.',
          },
        ],
      );
    const { changes } = input;
    const operationIds = new Set(session.changes.map((change) => change.operation.id));
    const evidence = new Set(session.target.observationScope.nodeIds);
    let candidate = clone(session.candidate);
    const staged: StoredChange[] = [];
    const stagedCreated = new Set(session.createdNodeIds);
    // Validate/apply sequentially against a temporary session, then publish the batch atomically.
    const simulation: StoredSession = { ...session, candidate, createdNodeIds: stagedCreated };
    for (const change of changes) {
      if (operationIds.has(change.operation.id))
        throw new CanvasSessionError(
          'duplicate-operation',
          `Operation ${change.operation.id} already exists`,
        );
      if (session.pinnedChangeIds.has(change.operation.id))
        throw new CanvasSessionError('pinned-change', `Operation ${change.operation.id} is pinned`);
      if (change.evidenceNodeIds.some((id) => !evidence.has(id)))
        throw new CanvasSessionError(
          'evidence-scope',
          'Evidence must come from the observation scope',
        );
      simulation.changes = [...session.changes, ...staged];
      validateScopedOperation(simulation, change.operation, change.dependencyIds);
      try {
        const before = candidate;
        const after = applyOperation(candidate, change.operation, this.now());
        validateIndirectMutations(simulation, before, after, change.operation);
        candidate = after;
      } catch (cause) {
        if (cause instanceof CanvasSessionError) throw cause;
        throw new CanvasSessionError(
          'operation-invalid',
          cause instanceof Error ? cause.message : 'Candidate operation is invalid',
        );
      }
      simulation.candidate = candidate;
      if (change.operation.type === 'create') stagedCreated.add(change.operation.node.id);
      operationIds.add(change.operation.id);
      staged.push({ ...change, appliedAt: this.now() });
    }
    session.candidate = candidate;
    session.createdNodeIds = stagedCreated;
    session.changes.push(...staged);
    session.validation = [];
    return {
      ok: true,
      appliedOperationIds: staged.map((change) => change.operation.id),
      candidateRevisionId: candidate.currentRevisionId,
      operationCount: session.changes.length,
    };
  }

  private validate(session: StoredSession) {
    const diagnostics = diagnosticsFor(session.candidate);
    if (!session.changes.length)
      diagnostics.push({
        code: 'empty-candidate',
        message: 'The candidate has no changes to review',
        repair: 'Apply at least one meaningful candidate operation.',
      });
    session.validation = diagnostics;
    return {
      ok: diagnostics.length === 0,
      diagnostics,
      checkedOperationCount: session.changes.length,
    };
  }

  private async submit(session: StoredSession) {
    const validation = this.validate(session);
    if (!validation.ok)
      throw new CanvasSessionError(
        'candidate-invalid',
        'Candidate must pass validation before submission',
        validation.diagnostics,
      );
    session.state = 'submitted';
    session.submittedAt = this.now();
    const result = {
      sessionId: session.id,
      state: session.state,
      sourceRevisionId: session.source.currentRevisionId,
      candidateRevisionId: session.candidate.currentRevisionId,
      requestedFidelity: session.requestedFidelity,
      operations: clone(session.changes),
      candidate: clone(session.candidate),
      traces: clone(session.traces),
      submittedAt: session.submittedAt,
    };
    await this.renders.cleanupSession(session.id);
    session.renders = [];
    return result;
  }

  private trace(
    session: StoredSession,
    tool: CanvasOperationalTrace['tool'],
    startedAt: number,
    argumentSummary: CanvasOperationalTrace['argumentSummary'],
    resultSummary: CanvasOperationalTrace['resultSummary'],
    renderHash?: string,
  ) {
    const evidenceNodeIds = Array.isArray(argumentSummary.evidenceNodeIds)
      ? argumentSummary.evidenceNodeIds
      : [];
    const componentIds =
      tool === 'components.describe' && Array.isArray(argumentSummary.ids)
        ? argumentSummary.ids
        : [];
    session.traces.push({
      sequence: session.traces.length,
      timestamp: startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      tool,
      sourceRevisionId: session.source.currentRevisionId,
      candidateRevisionId: session.candidate.currentRevisionId,
      argumentSummary,
      resultSummary,
      evidenceNodeIds,
      componentIds,
      renderHash,
    });
  }
}

export type { CanvasSessionServiceContract };
