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
  type ObservationScope,
} from '$lib/model/types';
import { z } from 'zod';

export const CANDIDATE_SCHEMA_VERSION = 'codesign-candidate-batch-v1';
export const PROMPT_VERSION = 'codesign-complete-v1';
export const SUPPORTED_ACTIONS = ['complete'] as const satisfies readonly CodesignAction[];

const MAX_CONTEXT_NODES = 250;
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

const wireOperationSchema = z.discriminatedUnion('type', [
  createOperationSchema,
  styleOperationSchema,
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

const visualSnapshotSchema = z.object({
  id: z.string().min(1).max(160),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const generationRequestSchema = z.object({
  action: z.enum(['complete', 'refine', 'vary', 'resolve']),
  requestedFidelity: fidelitySchema,
  observationScope: observationScopeSchema.extend({ nodeIds: z.array(z.string()).min(1).max(250) }),
  mutationScopeIds: z.array(z.string()).min(1).max(20),
  pinnedNodeIds: z.array(z.string()).max(250),
  pinnedAtomicChanges: z.array(atomicChangeSchema).max(6).default([]),
  visualSnapshot: visualSnapshotSchema.optional(),
  document: z.object({
    currentRevisionId: z.string().min(1),
    activeScreenId: z.string().min(1),
    knownNodeIds: z.array(z.string()).max(MAX_KNOWN_NODE_IDS),
    nodes: z.record(z.string(), nodeSchema),
  }),
});

export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export class CandidateValidationError extends Error {}

type BackendMetadata = {
  backend: 'local' | 'codex';
  model?: string;
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

function normalizeOperation(
  operation: z.infer<typeof wireOperationSchema>,
  request: GenerationRequest,
  runId: string,
): DesignOperation {
  assertNamespaced(operation.id, runId, 'Operation ID');
  if (operation.type === 'style') {
    const patch = compactStyle(operation.patch);
    assertStyleTokens(patch);
    if (operation.targetIds.some((id) => !request.mutationScopeIds.includes(id)))
      throw new CandidateValidationError('Style operation exceeds the mutation scope');
    return { ...operation, patch } as DesignOperation;
  }

  const source = operation.node;
  assertNamespaced(source.id, runId, 'Created node ID');
  if (request.document.knownNodeIds.includes(source.id))
    throw new CandidateValidationError('Created node ID collides with the document');
  if (source.screenId !== request.document.activeScreenId)
    throw new CandidateValidationError('Created node must stay on the active screen');
  if (!source.parentId || !request.mutationScopeIds.includes(source.parentId))
    throw new CandidateValidationError('Created node must be placed inside the mutation scope');
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
    parentId: source.parentId,
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
    rootIds: Object.values(request.document.nodes)
      .filter((node) => !node.parentId)
      .map((node) => node.id),
  };
  document.branches[0].screenIds = [request.document.activeScreenId];
  document.nodes = structuredClone(request.document.nodes);
  document.pinnedNodeIds = [...request.pinnedNodeIds];
  return document;
}

function stateForOperation(document: DesignDocument, operation: DesignOperation) {
  if (operation.type === 'style')
    return {
      nodes: Object.fromEntries(
        operation.targetIds.map((id) => [id, structuredClone(document.nodes[id])]),
      ),
    };
  if (operation.type === 'create') {
    const nodes: Record<string, DesignNode | null> = { [operation.node.id]: null };
    if (operation.node.parentId)
      nodes[operation.node.parentId] = structuredClone(document.nodes[operation.node.parentId]);
    return { nodes };
  }
  throw new CandidateValidationError('Unsupported candidate operation');
}

function afterStateForOperation(document: DesignDocument, operation: DesignOperation) {
  if (operation.type === 'style')
    return {
      nodes: Object.fromEntries(
        operation.targetIds.map((id) => [id, structuredClone(document.nodes[id])]),
      ),
    };
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
    observationScope: request.observationScope,
    mutationScopeIds: request.mutationScopeIds,
    pinnedNodeIds: request.pinnedNodeIds,
    requestedFidelity: request.requestedFidelity,
    contextSnapshotId: request.visualSnapshot?.id,
    candidateIds: [],
    backend: metadata.backend,
    model: metadata.model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    createdAt: metadata.createdAt,
  };
}

export function validateGenerationRequest(request: GenerationRequest) {
  unique(request.observationScope.nodeIds, 'Observation scope IDs');
  unique(request.mutationScopeIds, 'Mutation scope IDs');
  unique(request.pinnedNodeIds, 'Pinned node IDs');
  unique(
    request.pinnedAtomicChanges.map((change) => change.id),
    'Pinned atomic change IDs',
  );
  unique(request.document.knownNodeIds, 'Known node IDs');
  if (!SUPPORTED_ACTIONS.includes(request.action as (typeof SUPPORTED_ACTIONS)[number]))
    throw new CandidateValidationError(`${request.action} is not available in this build`);
  if (Object.keys(request.document.nodes).length > MAX_CONTEXT_NODES)
    throw new CandidateValidationError('Observation context is too large');
  for (const [id, node] of Object.entries(request.document.nodes)) {
    if (id !== node.id)
      throw new CandidateValidationError('Context node key does not match its ID');
    if (!request.document.knownNodeIds.includes(id))
      throw new CandidateValidationError('Context contains an unknown document ID');
  }
  if (request.observationScope.nodeIds.some((id) => !request.document.nodes[id]))
    throw new CandidateValidationError('Observation scope is missing from the document slice');
  if (request.mutationScopeIds.some((id) => !request.observationScope.nodeIds.includes(id)))
    throw new CandidateValidationError('Mutation scope must be observable');
  if (request.mutationScopeIds.some((id) => !request.document.nodes[id]))
    throw new CandidateValidationError('Mutation scope is missing from the document slice');
  if (
    request.mutationScopeIds.some(
      (id) => request.document.nodes[id].screenId !== request.document.activeScreenId,
    )
  )
    throw new CandidateValidationError('Mutation scope must stay on the active screen');
  if (request.pinnedNodeIds.some((id) => !request.document.knownNodeIds.includes(id)))
    throw new CandidateValidationError('Pinned scope contains an unknown node');
  if (request.mutationScopeIds.some((id) => request.pinnedNodeIds.includes(id)))
    throw new CandidateValidationError('Pinned nodes cannot be mutation targets');
  for (const change of request.pinnedAtomicChanges) {
    if (change.operation.actor !== 'agent')
      throw new CandidateValidationError('Pinned atomic changes must be agent-authored');
    if (!['create', 'style'].includes(change.operation.type))
      throw new CandidateValidationError('Pinned atomic change uses an unsupported operation');
    if (change.trace.evidenceNodeIds.some((id) => !request.observationScope.nodeIds.includes(id)))
      throw new CandidateValidationError('Pinned atomic evidence exceeds the observation scope');
  }
}

function stableOperationSignature(operation: DesignOperation) {
  if (operation.type === 'style')
    return JSON.stringify({
      type: operation.type,
      targetIds: operation.targetIds,
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
        parentId: node.parentId,
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
  for (const wireChange of wireChanges) {
    assertNamespaced(wireChange.id, run.id, 'Atomic change ID');
    if (wireChange.candidateId !== payload.candidate.id)
      throw new CandidateValidationError('Atomic change belongs to another candidate');
    unique(wireChange.dependencyIds, 'Atomic dependency IDs');
    unique(wireChange.trace.evidenceNodeIds, 'Trace evidence IDs');
    unique(wireChange.trace.affectedNodeIds, 'Trace affected IDs');
    if (
      wireChange.trace.evidenceNodeIds.some((id) => !request.observationScope.nodeIds.includes(id))
    )
      throw new CandidateValidationError('Trace evidence exceeds the observation scope');
    const operation = normalizeOperation(wireChange.operation, request, run.id);
    if (wireChange.preservedFromAtomicChangeId) {
      const source = request.pinnedAtomicChanges.find(
        (change) => change.id === wireChange.preservedFromAtomicChangeId,
      );
      if (!source) throw new CandidateValidationError('Candidate claims an unknown pinned change');
      if (preserved.has(source.id))
        throw new CandidateValidationError('Pinned atomic change was duplicated');
      if (stableOperationSignature(source.operation) !== stableOperationSignature(operation))
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
        : operation.type === 'style'
          ? operation.targetIds
          : [];
    if (operationAffected.some((id) => !wireChange.trace.affectedNodeIds.includes(id)))
      throw new CandidateValidationError('Trace does not identify every affected node');
    if (
      wireChange.trace.affectedNodeIds.some(
        (id) => !request.mutationScopeIds.includes(id) && !createdIds.includes(id),
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
  radius: nullable({ type: 'number', minimum: 0 }),
  padding: nullable({ type: 'number', minimum: 0 }),
  textColor: nullable({ type: 'string' }),
  fontSize: nullable({ type: 'number', exclusiveMinimum: 0 }),
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
    observationScope: run.observationScope,
    mutationScopeIds: run.mutationScopeIds,
    pinnedNodeIds: run.pinnedNodeIds,
    pinnedAtomicChanges: request.pinnedAtomicChanges.map((change) => ({
      id: change.id,
      operation: change.operation,
      dependencyIds: change.dependencyIds,
      trace: change.trace,
    })),
    visualSnapshot: request.visualSnapshot,
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
