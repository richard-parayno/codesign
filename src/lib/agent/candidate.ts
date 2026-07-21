import { validateComponentBinding } from '$lib/design-system/registry';
import { applyOperation } from '$lib/model/operations';
import {
  blankDocument,
  atomicChangeSchema,
  boundsSchema,
  fidelitySchema,
  nodeSchema,
  observationScopeSchema,
  styleSchema,
  type AtomicChange,
  type CodesignAction,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type Fidelity,
  type GenerationRun,
} from '$lib/model/types';
import { z } from 'zod';

export const CANDIDATE_SCHEMA_VERSION = 'codesign-candidate-batch-v1';
export const PROMPT_VERSION = 'codesign-complete-v1';
export const SUPPORTED_ACTIONS = ['complete'] as const satisfies readonly CodesignAction[];

const MAX_KNOWN_NODE_IDS = 5_000;
const componentIds = [
  'Card',
  'DataRow',
  'DataTable',
  'Sidebar',
  'NavItem',
  'Button',
  'Input',
  'Badge',
  'Panel',
] as const;

const nullableStyleSchema = z.object({
  fill: z.string().nullable(),
  stroke: z.string().nullable(),
  strokeWidth: z.number().finite().nonnegative().nullable(),
  opacity: z.number().finite().min(0).max(1).nullable(),
  radius: z.number().finite().nonnegative().nullable(),
  padding: z.number().finite().nonnegative().nullable(),
  textColor: z.string().nullable(),
  fontSize: z.number().finite().positive().nullable(),
  fontWeight: z.number().finite().min(1).max(1000).nullable(),
  textAlign: z.enum(['left', 'center', 'right']).nullable(),
  lineHeight: z.number().finite().positive().nullable(),
  density: z.enum(['compact', 'comfortable']).nullable(),
});

const componentPropsEnvelopeSchema = z.object({
  density: z.enum(['compact', 'comfortable']).nullable(),
  radius: z.enum(['small', 'medium']).nullable(),
  interactive: z.boolean().nullable(),
  collapsed: z.boolean().nullable(),
  active: z.boolean().nullable(),
  variant: z.enum(['primary', 'secondary', 'ghost']).nullable(),
  size: z.enum(['small', 'medium']).nullable(),
  tone: z.enum(['neutral', 'success', 'accent']).nullable(),
  side: z.enum(['left', 'right']).nullable(),
});

const wireNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  kind: z.enum(['frame', 'rectangle', 'text', 'group', 'instance']),
  screenId: z.string().min(1),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()).max(30),
  bounds: boundsSchema,
  style: styleSchema.extend({ density: z.enum(['compact', 'comfortable']).nullable() }),
  text: z.string().max(500).nullable(),
  componentBinding: z
    .object({
      componentId: z.enum(componentIds),
      props: componentPropsEnvelopeSchema,
    })
    .nullable(),
});

const createOperationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('create'),
  actor: z.literal('agent'),
  node: wireNodeSchema,
});

const styleOperationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('style'),
  actor: z.literal('agent'),
  targetIds: z.array(z.string()).min(1).max(20),
  patch: nullableStyleSchema,
});

const updateNodeOperationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('update-node'),
  actor: z.literal('agent'),
  targetIds: z.array(z.string()).min(1).max(20),
  patch: z
    .object({
      name: z.string().min(1).max(120).optional(),
      text: z.string().max(10_000).optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0),
});

const moveOperationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('move'),
  actor: z.literal('agent'),
  targetIds: z.array(z.string()).min(1).max(20),
  dx: z.number().finite(),
  dy: z.number().finite(),
});

const resizeOperationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('resize'),
  actor: z.literal('agent'),
  targetId: z.string().min(1),
  bounds: boundsSchema,
});

const wireOperationSchema = z.discriminatedUnion('type', [
  createOperationSchema,
  styleOperationSchema,
  updateNodeOperationSchema,
  moveOperationSchema,
  resizeOperationSchema,
]);

const traceSchema = z.object({
  observation: z.string().min(1).max(1000),
  context: z.string().min(1).max(1000),
  inference: z.string().min(1).max(1000),
  proposedChange: z.string().min(1).max(1000),
  evidenceNodeIds: z.array(z.string()).min(1).max(30),
  affectedNodeIds: z.array(z.string()).min(1).max(30),
});

const wireAtomicChangeSchema = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  preservedFromAtomicChangeId: z.string().nullable(),
  operation: wireOperationSchema,
  dependencyIds: z.array(z.string()).max(20),
  trace: traceSchema,
});

export const agentCandidateBatchSchema = z.object({
  schemaVersion: z.literal(CANDIDATE_SCHEMA_VERSION),
  candidate: z.object({
    id: z.string().min(1),
    fidelity: fidelitySchema,
    atomicChanges: z.array(wireAtomicChangeSchema).min(3).max(12),
  }),
});

export type AgentCandidateBatch = z.infer<typeof agentCandidateBatchSchema>;

/** Converts model-authored observation-root-relative bounds back to document coordinates. */
export function candidateToDocumentCoordinates(
  value: AgentCandidateBatch,
  origin: { x: number; y: number },
): AgentCandidateBatch {
  const candidate = structuredClone(value);
  for (const change of candidate.candidate.atomicChanges) {
    const operation = change.operation;
    if (operation.type === 'create' || operation.type === 'resize') {
      const bounds = operation.type === 'create' ? operation.node.bounds : operation.bounds;
      bounds.x += origin.x;
      bounds.y += origin.y;
    }
  }
  return candidate;
}

/** Converts a persisted document-coordinate operation into the model's scene-relative space. */
export function operationToSceneCoordinates(
  value: DesignOperation,
  origin: { x: number; y: number },
): DesignOperation {
  const operation = structuredClone(value);
  if (operation.type === 'create' || operation.type === 'resize') {
    const bounds = operation.type === 'create' ? operation.node.bounds : operation.bounds;
    bounds.x -= origin.x;
    bounds.y -= origin.y;
  }
  return operation;
}

const visualSnapshotSchema = z.object({
  id: z.string().min(1).max(160),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive().max(4_096),
  height: z.number().int().positive().max(4_096),
  data: z.string().min(16).max(12_000_000),
});

export const generationRequestSchema = z.object({
  projectId: z.string().min(1).max(160).default('local-project'),
  action: z.enum(['complete', 'refine', 'vary', 'resolve']),
  requestedFidelity: fidelitySchema,
  providerOptions: z
    .object({
      model: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/)
        .optional(),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    })
    .optional(),
  target: z.object({
    focusNodeIds: z.array(z.string()).min(1).max(20),
    observationScope: observationScopeSchema.extend({
      nodeIds: z.array(z.string()).min(1).max(MAX_KNOWN_NODE_IDS),
    }),
    mutationScope: z.object({
      existingNodeIds: z.array(z.string()).max(20),
      insertionParentIds: z.array(z.string()).max(20),
      regions: z.array(boundsSchema).min(1).max(20),
      allowCreate: z.boolean(),
    }),
  }),
  pinnedNodeIds: z.array(z.string()).max(250),
  pinnedAtomicChanges: z.array(atomicChangeSchema).max(6).default([]),
  visualSnapshot: visualSnapshotSchema.optional(),
  document: z.object({
    currentRevisionId: z.string().min(1),
    activeScreenId: z.string().min(1),
    screenName: z.string().min(1).max(120).default('Screen'),
    screenRootIds: z.array(z.string()).max(MAX_KNOWN_NODE_IDS).default([]),
    knownNodeIds: z.array(z.string()).max(MAX_KNOWN_NODE_IDS),
    nodes: z.record(z.string(), nodeSchema),
    frameFidelity: z.record(z.string(), fidelitySchema).default({}),
    nodeFidelityOverrides: z.record(z.string(), fidelitySchema).default({}),
  }),
});

export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export class CandidateValidationError extends Error {}

type BackendMetadata = {
  backend: 'local' | 'codex';
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  fallback?: boolean;
  contextNodeIds?: string[];
  contextRootId?: string;
  contextSummarized?: boolean;
  contextSchemaVersion?: string;
  trustedSnapshot?: {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    sha256: string;
  };
  runId: string;
  createdAt: number;
};

const allowedColors = new Set([
  'transparent',
  '#ffffff',
  '#f6f7f9',
  '#eef0f3',
  '#d9dde3',
  '#a7adb7',
  '#747b88',
  '#20242b',
  '#2563eb',
]);
const allowedRadius = new Set([0, 4, 8, 12, 16]);
const allowedPadding = new Set([0, 4, 8, 12, 16, 24]);
const allowedFontSize = new Set([12, 14, 16, 20, 24]);

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length)
    throw new CandidateValidationError(`${label} must be unique`);
}

function assertNamespaced(value: string, runId: string, label: string) {
  if (!value.startsWith(`${runId}-`))
    throw new CandidateValidationError(`${label} must use the generation run namespace`);
}

function compactProps(props: z.infer<typeof componentPropsEnvelopeSchema>) {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== null));
}

function compactStyle(patch: z.infer<typeof nullableStyleSchema>) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
}

function assertStyleTokens(style: Partial<DesignNode['style']>) {
  for (const key of ['fill', 'stroke', 'textColor'] as const)
    if (style[key] !== undefined && !allowedColors.has(style[key]!))
      throw new CandidateValidationError(`Agent style uses an unregistered ${key} value`);
  if (style.radius !== undefined && !allowedRadius.has(style.radius))
    throw new CandidateValidationError('Agent style uses an unregistered radius value');
  if (style.padding !== undefined && !allowedPadding.has(style.padding))
    throw new CandidateValidationError('Agent style uses an unregistered padding value');
  if (style.fontSize !== undefined && !allowedFontSize.has(style.fontSize))
    throw new CandidateValidationError('Agent style uses an unregistered font-size value');
}

function boundsInsideRegion(bounds: DesignNode['bounds'], request: GenerationRequest) {
  return request.target.mutationScope.regions.some(
    (region) =>
      bounds.x >= region.x &&
      bounds.y >= region.y &&
      bounds.x + bounds.width <= region.x + region.width &&
      bounds.y + bounds.height <= region.y + region.height,
  );
}

function normalizeOperation(
  operation: z.infer<typeof wireOperationSchema>,
  request: GenerationRequest,
  runId: string,
  simulation: DesignDocument,
  createdBy: ReadonlyMap<string, string>,
  dependencyIds: string[],
): DesignOperation {
  assertNamespaced(operation.id, runId, 'Operation ID');
  const existingMutable = new Set(request.target.mutationScope.existingNodeIds);
  const assertMutableTargets = (ids: string[]) => {
    if (ids.some((id) => !existingMutable.has(id) && !createdBy.has(id)))
      throw new CandidateValidationError(`${operation.type} operation exceeds the mutation scope`);
    if (ids.some((id) => request.pinnedNodeIds.includes(id)))
      throw new CandidateValidationError('Pinned nodes cannot be mutation targets');
    if (
      ids.some((id) => {
        const creationChangeId = createdBy.get(id);
        return creationChangeId && !dependencyIds.includes(creationChangeId);
      })
    )
      throw new CandidateValidationError(
        'Mutation of a generated node must depend on its creation change',
      );
  };
  if (operation.type === 'style') {
    const patch = compactStyle(operation.patch);
    assertStyleTokens(patch);
    assertMutableTargets(operation.targetIds);
    return { ...operation, patch } as DesignOperation;
  }
  if (operation.type === 'update-node') {
    assertMutableTargets(operation.targetIds);
    return operation;
  }
  if (operation.type === 'move') {
    assertMutableTargets(operation.targetIds);
    for (const id of operation.targetIds) {
      const node = simulation.nodes[id];
      if (!node) throw new CandidateValidationError('Move target does not exist');
      const moved = {
        ...node.bounds,
        x: node.bounds.x + operation.dx,
        y: node.bounds.y + operation.dy,
      };
      if (!boundsInsideRegion(moved, request))
        throw new CandidateValidationError('Move operation exceeds the editable region');
    }
    return operation;
  }
  if (operation.type === 'resize') {
    assertMutableTargets([operation.targetId]);
    if (!boundsInsideRegion(operation.bounds, request))
      throw new CandidateValidationError('Resize operation exceeds the editable region');
    return operation;
  }

  const source = operation.node;
  if (!request.target.mutationScope.allowCreate)
    throw new CandidateValidationError('Creation is disabled for this generation target');
  assertNamespaced(source.id, runId, 'Created node ID');
  if (request.document.knownNodeIds.includes(source.id) || createdBy.has(source.id))
    throw new CandidateValidationError('Created node ID collides with the document');
  if (source.screenId !== request.document.activeScreenId)
    throw new CandidateValidationError('Created node must stay on the active screen');
  if (source.parentId) {
    const parentCreation = createdBy.get(source.parentId);
    if (parentCreation && !dependencyIds.includes(parentCreation))
      throw new CandidateValidationError('Nested creation must depend on its parent creation');
    if (
      !parentCreation &&
      !request.target.mutationScope.insertionParentIds.includes(source.parentId)
    )
      throw new CandidateValidationError('Created node uses an unsupported insertion parent');
    const parent = simulation.nodes[source.parentId];
    if (!parent || (parent.kind !== 'frame' && parent.kind !== 'group'))
      throw new CandidateValidationError('Created node parent must be a frame or group');
  } else if (
    request.target.mutationScope.insertionParentIds.length > 0 ||
    request.target.observationScope.kind !== 'screen'
  ) {
    throw new CandidateValidationError('Created root is not allowed for this target');
  }
  if (!boundsInsideRegion(source.bounds, request))
    throw new CandidateValidationError('Created node exceeds the editable region');
  if (source.childIds.length)
    throw new CandidateValidationError('Created nodes cannot claim unstaged children');
  assertStyleTokens({ ...source.style, density: source.style.density ?? undefined });
  const componentBinding = source.componentBinding
    ? {
        componentId: source.componentBinding.componentId,
        props: compactProps(source.componentBinding.props),
      }
    : undefined;
  if (componentBinding) {
    const binding = validateComponentBinding(componentBinding.componentId, componentBinding.props);
    if (!binding.ok) throw new CandidateValidationError(binding.error);
    if (source.kind !== 'instance')
      throw new CandidateValidationError('A component binding requires an instance node');
  }
  const node: DesignNode = {
    id: source.id,
    name: source.name,
    kind: source.kind,
    screenId: source.screenId,
    parentId: source.parentId ?? undefined,
    childIds: [],
    bounds: source.bounds,
    style: { ...source.style, density: source.style.density ?? undefined },
    text: source.text ?? undefined,
    componentBinding,
    provenance: { actor: 'agent', operationId: operation.id },
  };
  return { id: operation.id, type: 'create', actor: 'agent', node };
}

function simulationDocument(request: GenerationRequest) {
  const document = blankDocument();
  document.activeScreenId = request.document.activeScreenId;
  document.screens[0] = {
    ...document.screens[0],
    id: request.document.activeScreenId,
    name: request.document.screenName,
    rootIds: request.document.screenRootIds.filter((id) => request.document.nodes[id]),
  };
  document.branches[0].screenIds = [request.document.activeScreenId];
  document.nodes = structuredClone(request.document.nodes);
  document.pinnedNodeIds = [...request.pinnedNodeIds];
  return document;
}

function stateForOperation(document: DesignDocument, operation: DesignOperation) {
  if (['style', 'update-node', 'move'].includes(operation.type) && 'targetIds' in operation)
    return {
      nodes: Object.fromEntries(
        operation.targetIds.map((id) => [id, structuredClone(document.nodes[id])]),
      ),
    };
  if (operation.type === 'resize')
    return { nodes: { [operation.targetId]: structuredClone(document.nodes[operation.targetId]) } };
  if (operation.type === 'create') {
    const nodes: Record<string, DesignNode | null> = { [operation.node.id]: null };
    if (operation.node.parentId)
      nodes[operation.node.parentId] = structuredClone(document.nodes[operation.node.parentId]);
    return { nodes };
  }
  throw new CandidateValidationError('Unsupported candidate operation');
}

function afterStateForOperation(document: DesignDocument, operation: DesignOperation) {
  if (['style', 'update-node', 'move'].includes(operation.type) && 'targetIds' in operation)
    return {
      nodes: Object.fromEntries(
        operation.targetIds.map((id) => [id, structuredClone(document.nodes[id])]),
      ),
    };
  if (operation.type === 'resize')
    return { nodes: { [operation.targetId]: structuredClone(document.nodes[operation.targetId]) } };
  if (operation.type === 'create') {
    const nodes: Record<string, DesignNode | null> = {
      [operation.node.id]: structuredClone(document.nodes[operation.node.id]),
    };
    if (operation.node.parentId)
      nodes[operation.node.parentId] = structuredClone(document.nodes[operation.node.parentId]);
    return { nodes };
  }
  throw new CandidateValidationError('Unsupported candidate operation');
}

function validateDependencies(changes: AtomicChange[]) {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new CandidateValidationError('Atomic dependencies must be acyclic');
    const change = byId.get(id);
    if (!change) throw new CandidateValidationError('Atomic dependency does not exist');
    visiting.add(id);
    change.dependencyIds.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  changes.forEach((change) => visit(change.id));
}

function validateWireDependencies(changes: z.infer<typeof wireAtomicChangeSchema>[]) {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new CandidateValidationError('Atomic dependencies must be acyclic');
    const change = byId.get(id);
    if (!change) throw new CandidateValidationError('Atomic dependency does not exist');
    visiting.add(id);
    change.dependencyIds.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  changes.forEach((change) => visit(change.id));
  const position = new Map(changes.map((change, index) => [change.id, index]));
  changes.forEach((change, index) => {
    if (change.dependencyIds.some((id) => (position.get(id) ?? Number.MAX_SAFE_INTEGER) >= index))
      throw new CandidateValidationError('Atomic changes must follow dependency order');
  });
}

export function createGenerationRun(
  request: GenerationRequest,
  metadata: BackendMetadata,
): GenerationRun {
  return {
    id: metadata.runId,
    sourceRevisionId: request.document.currentRevisionId,
    action: request.action,
    target: request.target,
    pinnedNodeIds: request.pinnedNodeIds,
    requestedFidelity: request.requestedFidelity,
    contextSnapshotId: request.visualSnapshot?.id,
    contextNodeIds: metadata.contextNodeIds ?? request.target.observationScope.nodeIds,
    contextRootId: metadata.contextRootId ?? request.target.observationScope.rootId,
    contextSummarized: metadata.contextSummarized ?? false,
    snapshot: metadata.trustedSnapshot,
    candidateIds: [],
    backend: metadata.backend,
    provider: metadata.backend,
    model: metadata.model,
    reasoningEffort: metadata.reasoningEffort,
    fallback: metadata.fallback ?? false,
    promptVersion: PROMPT_VERSION,
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    contextSchemaVersion: metadata.contextSchemaVersion ?? 'codesign-scene-context-v1',
    createdAt: metadata.createdAt,
  };
}

export function validateGenerationRequest(request: GenerationRequest) {
  const target = request.target;
  unique(target.focusNodeIds, 'Focus node IDs');
  unique(target.observationScope.nodeIds, 'Observation scope IDs');
  unique(target.mutationScope.existingNodeIds, 'Existing mutation IDs');
  unique(target.mutationScope.insertionParentIds, 'Insertion parent IDs');
  unique(request.pinnedNodeIds, 'Pinned node IDs');
  unique(
    request.pinnedAtomicChanges.map((change) => change.id),
    'Pinned atomic change IDs',
  );
  unique(request.document.knownNodeIds, 'Known node IDs');
  if (!SUPPORTED_ACTIONS.includes(request.action as (typeof SUPPORTED_ACTIONS)[number]))
    throw new CandidateValidationError(`${request.action} is not available in this build`);
  if (Object.keys(request.document.nodes).length > MAX_KNOWN_NODE_IDS)
    throw new CandidateValidationError('Observation context exceeds the supported bound');
  for (const [id, node] of Object.entries(request.document.nodes)) {
    if (id !== node.id)
      throw new CandidateValidationError('Context node key does not match its ID');
    if (!request.document.knownNodeIds.includes(id))
      throw new CandidateValidationError('Context contains an unknown document ID');
  }
  if (target.observationScope.nodeIds.some((id) => !request.document.nodes[id]))
    throw new CandidateValidationError('Observation scope is missing from the document slice');
  if (target.focusNodeIds.some((id) => !target.observationScope.nodeIds.includes(id)))
    throw new CandidateValidationError('Focus must be observable');
  if (target.focusNodeIds.some((id) => !request.document.nodes[id]))
    throw new CandidateValidationError('Focus is missing from the document slice');
  if (
    target.mutationScope.existingNodeIds.some((id) => !target.observationScope.nodeIds.includes(id))
  )
    throw new CandidateValidationError('Existing mutation scope must be observable');
  if (target.mutationScope.existingNodeIds.some((id) => !request.document.nodes[id]))
    throw new CandidateValidationError('Mutation scope is missing from the document slice');
  if (
    target.mutationScope.existingNodeIds.some(
      (id) => request.document.nodes[id].screenId !== request.document.activeScreenId,
    )
  )
    throw new CandidateValidationError('Mutation scope must stay on the active screen');
  if (request.pinnedNodeIds.some((id) => !request.document.knownNodeIds.includes(id)))
    throw new CandidateValidationError('Pinned scope contains an unknown node');
  if (target.mutationScope.existingNodeIds.some((id) => request.pinnedNodeIds.includes(id)))
    throw new CandidateValidationError('Pinned nodes cannot be mutation targets');
  for (const parentId of target.mutationScope.insertionParentIds) {
    const parent = request.document.nodes[parentId];
    if (!parent || !target.observationScope.nodeIds.includes(parentId))
      throw new CandidateValidationError('Insertion parent must be observable');
    if (parent.kind !== 'frame' && parent.kind !== 'group')
      throw new CandidateValidationError('Insertion parent must be a frame or group');
    if (request.pinnedNodeIds.includes(parentId))
      throw new CandidateValidationError('Pinned nodes cannot be insertion parents');
  }
  for (const change of request.pinnedAtomicChanges) {
    if (change.operation.actor !== 'agent')
      throw new CandidateValidationError('Pinned atomic changes must be agent-authored');
    if (!['create', 'style'].includes(change.operation.type))
      throw new CandidateValidationError('Pinned atomic change uses an unsupported operation');
    if (change.trace.evidenceNodeIds.some((id) => !target.observationScope.nodeIds.includes(id)))
      throw new CandidateValidationError('Pinned atomic evidence exceeds the observation scope');
  }
  const pinnedChangeIds = new Set(request.pinnedAtomicChanges.map((change) => change.id));
  if (
    request.pinnedAtomicChanges.some((change) =>
      change.dependencyIds.some((id) => !pinnedChangeIds.has(id)),
    )
  )
    throw new CandidateValidationError('Pinned atomic changes must include their dependencies');
}

function stableOperationSignature(
  operation: DesignOperation,
  nodeIdRemap: ReadonlyMap<string, string> = new Map(),
) {
  if (operation.type === 'style')
    return JSON.stringify({
      type: operation.type,
      targetIds: operation.targetIds.map((id) => nodeIdRemap.get(id) ?? id),
      patch: operation.patch,
    });
  if (operation.type === 'create') {
    const node = operation.node;
    return JSON.stringify({
      type: operation.type,
      node: {
        name: node.name,
        kind: node.kind,
        screenId: node.screenId,
        parentId: node.parentId ? (nodeIdRemap.get(node.parentId) ?? node.parentId) : node.parentId,
        bounds: node.bounds,
        style: node.style,
        text: node.text,
        componentBinding: node.componentBinding,
      },
    });
  }
  return JSON.stringify({ type: operation.type });
}

function stableTraceSignature(change: AtomicChange) {
  return JSON.stringify({
    observation: change.trace.observation,
    context: change.trace.context,
    inference: change.trace.inference,
    proposedChange: change.trace.proposedChange,
    evidenceNodeIds: change.trace.evidenceNodeIds,
  });
}

export function normalizeCandidateBatch(
  request: GenerationRequest,
  run: GenerationRun,
  value: unknown,
) {
  validateGenerationRequest(request);
  if (run.sourceRevisionId !== request.document.currentRevisionId)
    throw new CandidateValidationError('Candidate source revision is stale');
  const parsed = agentCandidateBatchSchema.safeParse(value);
  if (!parsed.success)
    throw new CandidateValidationError(
      parsed.error.issues[0]?.message ?? 'Invalid candidate batch',
    );
  const payload = parsed.data;
  assertNamespaced(payload.candidate.id, run.id, 'Candidate ID');
  if (payload.candidate.fidelity !== request.requestedFidelity)
    throw new CandidateValidationError('Candidate fidelity does not match the request');
  const wireChanges = payload.candidate.atomicChanges;
  unique(
    wireChanges.map((change) => change.id),
    'Atomic change IDs',
  );
  unique(
    wireChanges.map((change) => change.operation.id),
    'Operation IDs',
  );
  const createdIds = wireChanges.flatMap((change) =>
    change.operation.type === 'create' ? [change.operation.node.id] : [],
  );
  unique(createdIds, 'Created node IDs');
  validateWireDependencies(wireChanges);

  let simulation = simulationDocument(request);
  const changes: AtomicChange[] = [];
  const preserved = new Map<string, DesignOperation>();
  const createdBy = new Map<string, string>();
  const preservedNodeRemap = new Map<string, string>();
  for (const wireChange of wireChanges) {
    if (!wireChange.preservedFromAtomicChangeId || wireChange.operation.type !== 'create') continue;
    const source = request.pinnedAtomicChanges.find(
      (change) => change.id === wireChange.preservedFromAtomicChangeId,
    );
    if (source?.operation.type === 'create')
      preservedNodeRemap.set(source.operation.node.id, wireChange.operation.node.id);
  }
  for (const wireChange of wireChanges) {
    assertNamespaced(wireChange.id, run.id, 'Atomic change ID');
    if (wireChange.candidateId !== payload.candidate.id)
      throw new CandidateValidationError('Atomic change belongs to another candidate');
    unique(wireChange.dependencyIds, 'Atomic dependency IDs');
    unique(wireChange.trace.evidenceNodeIds, 'Trace evidence IDs');
    unique(wireChange.trace.affectedNodeIds, 'Trace affected IDs');
    if (
      wireChange.trace.evidenceNodeIds.some(
        (id) => !request.target.observationScope.nodeIds.includes(id),
      )
    )
      throw new CandidateValidationError('Trace evidence exceeds the observation scope');
    const operation = normalizeOperation(
      wireChange.operation,
      request,
      run.id,
      simulation,
      createdBy,
      wireChange.dependencyIds,
    );
    if (wireChange.preservedFromAtomicChangeId) {
      const source = request.pinnedAtomicChanges.find(
        (change) => change.id === wireChange.preservedFromAtomicChangeId,
      );
      if (!source) throw new CandidateValidationError('Candidate claims an unknown pinned change');
      if (preserved.has(source.id))
        throw new CandidateValidationError('Pinned atomic change was duplicated');
      if (
        stableOperationSignature(source.operation, preservedNodeRemap) !==
        stableOperationSignature(operation)
      )
        throw new CandidateValidationError('Pinned atomic operation was not preserved');
      if (
        stableTraceSignature(source) !==
        JSON.stringify({
          observation: wireChange.trace.observation,
          context: wireChange.trace.context,
          inference: wireChange.trace.inference,
          proposedChange: wireChange.trace.proposedChange,
          evidenceNodeIds: wireChange.trace.evidenceNodeIds,
        })
      )
        throw new CandidateValidationError('Pinned atomic derivation trace was not preserved');
      preserved.set(source.id, operation);
    }
    const operationAffected =
      operation.type === 'create'
        ? [operation.node.id]
        : 'targetIds' in operation
          ? operation.targetIds
          : 'targetId' in operation
            ? [operation.targetId]
            : [];
    if (operationAffected.some((id) => !wireChange.trace.affectedNodeIds.includes(id)))
      throw new CandidateValidationError('Trace does not identify every affected node');
    if (
      wireChange.trace.affectedNodeIds.some(
        (id) =>
          !request.target.mutationScope.existingNodeIds.includes(id) && !createdIds.includes(id),
      )
    )
      throw new CandidateValidationError('Trace affected IDs exceed the mutation scope');
    const before = stateForOperation(simulation, operation);
    try {
      simulation = applyOperation(simulation, operation, run.createdAt);
    } catch (cause) {
      throw new CandidateValidationError(
        cause instanceof Error ? cause.message : 'Candidate operation could not be simulated',
      );
    }
    const after = afterStateForOperation(simulation, operation);
    if (operation.type === 'create') createdBy.set(operation.node.id, wireChange.id);
    changes.push({
      id: wireChange.id,
      candidateId: wireChange.candidateId,
      preservedFromAtomicChangeId: wireChange.preservedFromAtomicChangeId ?? undefined,
      operation,
      dependencyIds: wireChange.dependencyIds,
      trace: wireChange.trace,
      before,
      after,
    });
  }
  validateDependencies(changes);
  if (preserved.size !== request.pinnedAtomicChanges.length)
    throw new CandidateValidationError('Candidate omitted a pinned atomic change');
  const preservedWire = new Map(
    wireChanges
      .filter((change) => change.preservedFromAtomicChangeId)
      .map((change) => [change.preservedFromAtomicChangeId!, change]),
  );
  const pinnedSourceIds = new Set(request.pinnedAtomicChanges.map((change) => change.id));
  for (const source of request.pinnedAtomicChanges) {
    const returned = preservedWire.get(source.id)!;
    const expectedDependencies = source.dependencyIds
      .filter((id) => pinnedSourceIds.has(id))
      .map((id) => preservedWire.get(id)?.id);
    if (expectedDependencies.some((id) => !id || !returned.dependencyIds.includes(id)))
      throw new CandidateValidationError('Pinned atomic dependencies were not preserved');
  }
  return {
    id: payload.candidate.id,
    fidelity: payload.candidate.fidelity,
    atomicChanges: changes,
    createdAt: run.createdAt,
  };
}

export type CandidateOutputSchema = Record<string, unknown>;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const stringEnum = (values: readonly string[]) => ({ type: 'string', enum: values });
const styleProperties = {
  fill: nullable({ type: 'string' }),
  stroke: nullable({ type: 'string' }),
  strokeWidth: nullable({ type: 'number', minimum: 0 }),
  opacity: nullable({ type: 'number', minimum: 0, maximum: 1 }),
  radius: nullable({ type: 'number', minimum: 0 }),
  padding: nullable({ type: 'number', minimum: 0 }),
  textColor: nullable({ type: 'string' }),
  fontSize: nullable({ type: 'number', exclusiveMinimum: 0 }),
  fontWeight: nullable({ type: 'number', minimum: 1, maximum: 1000 }),
  textAlign: nullable(stringEnum(['left', 'center', 'right'])),
  lineHeight: nullable({ type: 'number', exclusiveMinimum: 0 }),
  density: nullable(stringEnum(['compact', 'comfortable'])),
};
const propsProperties = {
  density: nullable(stringEnum(['compact', 'comfortable'])),
  radius: nullable(stringEnum(['small', 'medium'])),
  interactive: nullable({ type: 'boolean' }),
  collapsed: nullable({ type: 'boolean' }),
  active: nullable({ type: 'boolean' }),
  variant: nullable(stringEnum(['primary', 'secondary', 'ghost'])),
  size: nullable(stringEnum(['small', 'medium'])),
  tone: nullable(stringEnum(['neutral', 'success', 'accent'])),
  side: nullable(stringEnum(['left', 'right'])),
};
const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const wireNodeJsonSchema = strictObject({
  id: { type: 'string' },
  name: { type: 'string' },
  kind: stringEnum(['frame', 'rectangle', 'text', 'group', 'instance']),
  screenId: { type: 'string' },
  parentId: nullable({ type: 'string' }),
  childIds: { type: 'array', items: { type: 'string' } },
  bounds: strictObject({
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
  }),
  style: strictObject({
    ...styleProperties,
    density: nullable(stringEnum(['compact', 'comfortable'])),
  }),
  text: nullable({ type: 'string' }),
  componentBinding: nullable(
    strictObject({
      componentId: stringEnum(componentIds),
      props: strictObject(propsProperties),
    }),
  ),
});
const traceJsonSchema = strictObject({
  observation: { type: 'string' },
  context: { type: 'string' },
  inference: { type: 'string' },
  proposedChange: { type: 'string' },
  evidenceNodeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
  affectedNodeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
});

export const candidateBatchOutputSchema: CandidateOutputSchema = strictObject({
  schemaVersion: { type: 'string', enum: [CANDIDATE_SCHEMA_VERSION] },
  candidate: strictObject({
    id: { type: 'string' },
    fidelity: stringEnum(['structure', 'wireframe', 'component', 'visual', 'production']),
    atomicChanges: {
      type: 'array',
      minItems: 3,
      maxItems: 12,
      items: strictObject({
        id: { type: 'string' },
        candidateId: { type: 'string' },
        preservedFromAtomicChangeId: nullable({ type: 'string' }),
        operation: {
          anyOf: [
            strictObject({
              id: { type: 'string' },
              type: { type: 'string', enum: ['create'] },
              actor: { type: 'string', enum: ['agent'] },
              node: wireNodeJsonSchema,
            }),
            strictObject({
              id: { type: 'string' },
              type: { type: 'string', enum: ['style'] },
              actor: { type: 'string', enum: ['agent'] },
              targetIds: { type: 'array', minItems: 1, items: { type: 'string' } },
              patch: strictObject(styleProperties),
            }),
            strictObject({
              id: { type: 'string' },
              type: { type: 'string', enum: ['update-node'] },
              actor: { type: 'string', enum: ['agent'] },
              targetIds: { type: 'array', minItems: 1, items: { type: 'string' } },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: { name: { type: 'string' }, text: { type: 'string' } },
              },
            }),
            strictObject({
              id: { type: 'string' },
              type: { type: 'string', enum: ['move'] },
              actor: { type: 'string', enum: ['agent'] },
              targetIds: { type: 'array', minItems: 1, items: { type: 'string' } },
              dx: { type: 'number' },
              dy: { type: 'number' },
            }),
            strictObject({
              id: { type: 'string' },
              type: { type: 'string', enum: ['resize'] },
              actor: { type: 'string', enum: ['agent'] },
              targetId: { type: 'string' },
              bounds: strictObject({
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number', exclusiveMinimum: 0 },
                height: { type: 'number', exclusiveMinimum: 0 },
              }),
            }),
          ],
        },
        dependencyIds: { type: 'array', items: { type: 'string' } },
        trace: traceJsonSchema,
      }),
    },
  }),
});

export function safeAgentContext(request: GenerationRequest, run: GenerationRun) {
  return {
    action: run.action,
    requestedFidelity: run.requestedFidelity,
    sourceRevisionId: run.sourceRevisionId,
    idNamespace: run.id,
    target: run.target,
    pinnedNodeIds: run.pinnedNodeIds,
    pinnedAtomicChanges: request.pinnedAtomicChanges.map((change) => ({
      id: change.id,
      operation: change.operation,
      dependencyIds: change.dependencyIds,
      trace: change.trace,
    })),
    visualSnapshot: run.snapshot
      ? { id: run.contextSnapshotId, ...run.snapshot }
      : request.visualSnapshot
        ? {
            id: request.visualSnapshot.id,
            mimeType: request.visualSnapshot.mimeType,
            width: request.visualSnapshot.width,
            height: request.visualSnapshot.height,
          }
        : undefined,
    activeScreenId: request.document.activeScreenId,
    nodes: request.document.nodes,
  };
}

export type TrustedVisualInput =
  | { type: 'image'; url: string; detail?: 'auto' | 'low' | 'high' | 'original' }
  | { type: 'localImage'; path: string; detail?: 'auto' | 'low' | 'high' | 'original' };

export type CandidateGenerationResponse = {
  run: GenerationRun;
  candidates: ReturnType<typeof normalizeCandidateBatch>[];
  fallback: boolean;
  supportedActions: typeof SUPPORTED_ACTIONS;
  visualInputUsed: boolean;
  message?: string;
};
