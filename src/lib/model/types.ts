import { z } from 'zod';

export type Actor = 'user' | 'agent';
export type ProcessActor = Actor | 'system';
/** @deprecated Retained only so v1 nodes and operation records remain readable. */
export type Commitment = 'ambiguous' | 'inferred' | 'confirmed';
export type NodeKind = 'frame' | 'rectangle' | 'text' | 'group' | 'instance';
/** @deprecated The v2 interaction uses explicit CodesignAction requests. */
export type Agency = 'protect' | 'guide' | 'explore';
export type Fidelity = 'structure' | 'wireframe' | 'component' | 'visual' | 'production';
export type Origin = 'human' | 'ai' | 'mixed';
export type CodesignAction = 'complete' | 'refine' | 'vary' | 'resolve';
export type ScopeKind = 'selection' | 'parent' | 'frame' | 'screen';
export type CandidateStatus = 'candidate' | 'partially-accepted' | 'accepted' | 'rejected';
export type AtomicDecision = 'pending' | 'accepted' | 'rejected';

export type Bounds = { x: number; y: number; width: number; height: number };
export type StyleProperties = {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity: number;
  radius: number;
  padding: number;
  textColor: string;
  fontSize: number;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  density?: 'compact' | 'comfortable';
};
export type StylePatch = Omit<Partial<StyleProperties>, 'stroke' | 'strokeWidth'> & {
  stroke?: string | null;
  strokeWidth?: number | null;
};
export type LegacyNodeSemantics = {
  role: string;
  commitment: Commitment;
  protected?: boolean;
};
export type ProjectComponentLink = {
  componentId: string;
  role: 'main' | 'instance';
};
export type DesignNode = {
  id: string;
  name: string;
  kind: NodeKind;
  screenId: string;
  parentId?: string;
  childIds: string[];
  bounds: Bounds;
  style: StyleProperties;
  text?: string;
  clipContent?: boolean;
  /** Stable identity is assigned by the reducer when an older caller omits it. */
  entityId?: string;
  /** @deprecated Archived during v1 migration and ignored by the v2 interaction. */
  semantics?: LegacyNodeSemantics;
  componentBinding?: {
    componentId: string;
    props: Record<string, unknown>;
    /** Named manifest slot used when this component node is nested under another component. */
    slot?: string;
  };
  /** Links a project-authored main component or one of its reusable instances. */
  projectComponent?: ProjectComponentLink;
  repeaterId?: string;
  provenance: { actor: Actor; operationId: string };
};
export type ProjectComponentDefinition = {
  id: string;
  name: string;
  rootId: string;
  sourceNodeId: string;
  nodes: Record<string, DesignNode>;
  createdAt: number;
  updatedAt: number;
};
export type Screen = {
  id: string;
  name: string;
  rootIds: string[];
  branchId: string;
};
export type Transition = {
  id: string;
  sourceNodeId: string;
  targetScreenId: string;
  label: string;
};
export type Branch = { id: string; name: string; sourceScreenId?: string; screenIds: string[] };
export type IntentHypothesis = {
  id: string;
  targetIds: string[];
  kind: 'repetition' | 'hierarchy' | 'navigation' | 'state' | 'component-match';
  confidence: number;
  status: 'proposed' | 'accepted' | 'rejected';
  evidence: string[];
};

export type DesignOperation =
  | { id: string; type: 'create'; actor: Actor; node: DesignNode }
  | { id: string; type: 'move'; actor: Actor; targetIds: string[]; dx: number; dy: number }
  | { id: string; type: 'resize'; actor: Actor; targetId: string; bounds: Bounds }
  | { id: string; type: 'delete'; actor: Actor; targetIds: string[] }
  | { id: string; type: 'repeat'; actor: Actor; targetIds: string[]; repeaterId: string }
  | {
      id: string;
      type: 'bind';
      actor: Actor;
      targetIds: string[];
      role: string;
      commitment: Commitment;
    }
  | { id: string; type: 'transition'; actor: Actor; transition: Transition }
  | {
      id: string;
      type: 'promote';
      actor: Actor;
      targetIds: string[];
      componentId: string;
      props: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'style';
      actor: Actor;
      targetIds: string[];
      patch: StylePatch;
    }
  | {
      id: string;
      type: 'generalize';
      actor: Actor;
      sourceId: string;
      targetIds: string[];
      scope: 'repeater-siblings' | 'component-on-screen';
      patch: StylePatch;
    }
  | {
      id: string;
      type: 'update-node';
      actor: Actor;
      targetIds: string[];
      patch: { name?: string; text?: string; clipContent?: boolean };
    }
  | {
      id: string;
      type: 'reparent';
      actor: Actor;
      targetIds: string[];
      parentId?: string;
      /** Bottom-to-top insertion position in the destination stack. */
      index?: number;
    }
  | {
      id: string;
      type: 'group';
      actor: Actor;
      targetIds: string[];
      group: DesignNode;
    }
  | { id: string; type: 'ungroup'; actor: Actor; targetIds: string[] }
  | {
      id: string;
      type: 'reorder';
      actor: Actor;
      targetIds: string[];
      direction: 'forward' | 'backward' | 'front' | 'back';
    }
  | {
      id: string;
      type: 'duplicate';
      actor: Actor;
      targetIds: string[];
      /** Stable source-to-copy IDs supplied by the caller for clipboard/replay safety. */
      idMap: Record<string, string>;
      dx: number;
      dy: number;
    }
  | { id: string; type: 'duplicate-screen'; actor: Actor; sourceScreenId: string; screenId: string }
  | { id: string; type: 'create-branch'; actor: Actor; sourceScreenId: string; branchId: string }
  | {
      id: string;
      type: 'create-project-component';
      actor: Actor;
      targetId: string;
      definition: ProjectComponentDefinition;
    };

export type OperationRecord = DesignOperation & {
  timestamp: number;
  summary: string;
  transactionId?: string;
  sourceAtomicChangeId?: string;
};

export type DesignEntity = {
  id: string;
  parentEntityId?: string;
  representationIds: string[];
  activeRepresentationId: string;
};
export type Representation = {
  id: string;
  entityId: string;
  fidelity: Fidelity;
  origin: Origin;
  revisionId: string;
  rootNodeIds: string[];
};
export type ObservationScope = { kind: ScopeKind; rootId?: string; nodeIds: string[] };
export type MutationScope = {
  existingNodeIds: string[];
  insertionParentIds: string[];
  regions: Bounds[];
  allowCreate: boolean;
};
export type GenerationTarget = {
  focusNodeIds: string[];
  observationScope: ObservationScope;
  mutationScope: MutationScope;
};
export type DerivationTrace = {
  observation: string;
  context: string;
  inference: string;
  proposedChange: string;
  evidenceNodeIds: string[];
  affectedNodeIds: string[];
};
export type AtomicStateSlice = {
  nodes: Record<string, DesignNode | null>;
  screenRootIds?: Record<string, string[]>;
  transitions?: Record<string, Transition | null>;
};
export type AtomicChange = {
  id: string;
  candidateId: string;
  preservedFromAtomicChangeId?: string;
  operation: DesignOperation;
  dependencyIds: string[];
  trace: DerivationTrace;
  before: AtomicStateSlice;
  after: AtomicStateSlice;
};
export type GenerationRun = {
  id: string;
  sourceRevisionId: string;
  action: CodesignAction;
  target: GenerationTarget;
  pinnedNodeIds: string[];
  requestedFidelity: Fidelity;
  contextSnapshotId?: string;
  contextNodeIds: string[];
  contextRootId?: string;
  contextSummarized: boolean;
  snapshot?: {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    sha256: string;
  };
  candidateIds: string[];
  /** Current runs use Codex. `legacy` marks imported local runs and cannot generate. */
  provider: 'codex' | 'legacy';
  legacyProvider?: {
    id: 'local';
    fallback: boolean;
  };
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  promptVersion: string;
  schemaVersion: string;
  contextSchemaVersion: string;
  createdAt: number;
};
export type CandidateRevision = {
  id: string;
  generationRunId: string;
  sourceRevisionId: string;
  revisionId: string;
  fidelity: Fidelity;
  origin: 'ai';
  atomicChangeIds: string[];
  decisions: Record<string, AtomicDecision>;
  status: CandidateStatus;
  createdAt: number;
};

export type ProcessEventType =
  | 'legacy-imported'
  | 'manual-operation'
  | 'checkpoint-created'
  | 'generation-requested'
  | 'generation-failed'
  | 'generation-cancelled'
  | 'candidates-generated'
  | 'candidate-viewed'
  | 'candidate-rejected'
  | 'reroll-requested'
  | 'pin-changed'
  | 'atomic-decision'
  | 'candidate-accepted'
  | 'source-compared'
  | 'revision-activated'
  | 'replayed'
  | 'reverted';
export type ProcessEvent = {
  id: string;
  sequence: number;
  type: ProcessEventType;
  actor: ProcessActor;
  timestamp: number;
  revisionId?: string;
  generationRunId?: string;
  candidateId?: string;
  atomicChangeId?: string;
  details?: Record<string, string | number | boolean | null | string[]>;
};

export type CanvasSnapshot = {
  screens: Screen[];
  nodes: Record<string, DesignNode>;
  transitions: Transition[];
  branches: Branch[];
  activeBranchId: string;
  activeScreenId: string;
  entities: Record<string, DesignEntity>;
  representations: Record<string, Representation>;
  pinnedNodeIds: string[];
  frameFidelity: Record<string, Fidelity>;
  nodeFidelityOverrides: Record<string, Fidelity>;
  /** Optional for compatibility with project files saved before local components existed. */
  projectComponents?: Record<string, ProjectComponentDefinition>;
};
export type DesignRevision = {
  id: string;
  parentRevisionId?: string;
  status: 'working' | 'candidate' | 'accepted' | 'rejected';
  origin: Origin;
  createdAt: number;
  generationRunId?: string;
  candidateId?: string;
  operationIds: string[];
  atomicChangeIds: string[];
  snapshot: CanvasSnapshot;
};

export type LegacyDesignDocumentV1 = {
  version: 1;
  revision: number;
  screens: Screen[];
  nodes: Record<string, DesignNode>;
  transitions: Transition[];
  branches: Branch[];
  activeBranchId: string;
  activeScreenId: string;
  hypotheses: IntentHypothesis[];
  operations: OperationRecord[];
};
export type LegacyArchive = {
  sourceVersion: 1;
  sourceKey: string;
  migratedAt: number;
  document: LegacyDesignDocumentV1;
};

export type DesignDocument = CanvasSnapshot & {
  version: 2;
  /** Monotonic working revision retained for existing direct-operation callers. */
  revision: number;
  currentRevisionId: string;
  revisions: Record<string, DesignRevision>;
  generationRuns: Record<string, GenerationRun>;
  candidates: Record<string, CandidateRevision>;
  atomicChanges: Record<string, AtomicChange>;
  processEvents: ProcessEvent[];
  operations: OperationRecord[];
  legacyArchive?: LegacyArchive;
};

/** @deprecated Compatibility contract for the superseded single-operation agent flow. */
export type ProposedOperation = {
  id: string;
  baseRevision: number;
  targetIds: string[];
  operation: DesignOperation;
  rationale: string;
  confidence: number;
  source: 'local' | 'codex';
};

const finite = z.number().finite();
export const fidelitySchema = z.enum([
  'structure',
  'wireframe',
  'component',
  'visual',
  'production',
]);
export const boundsSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
});
export const styleSchema = z.object({
  fill: z.string(),
  stroke: z.string().optional(),
  strokeWidth: finite.nonnegative().optional(),
  opacity: finite.min(0).max(1).default(1),
  radius: finite.nonnegative(),
  padding: finite.nonnegative(),
  textColor: z.string(),
  fontSize: finite.positive(),
  fontWeight: finite.min(1).max(1000).default(400),
  textAlign: z.enum(['left', 'center', 'right']).default('left'),
  lineHeight: finite.positive().default(1.4),
  density: z.enum(['compact', 'comfortable']).optional(),
});
const stylePatchSchema: z.ZodType<StylePatch> = z.object({
  fill: z.string().optional(),
  stroke: z.string().nullable().optional(),
  strokeWidth: finite.nonnegative().nullable().optional(),
  opacity: finite.min(0).max(1).optional(),
  radius: finite.nonnegative().optional(),
  padding: finite.nonnegative().optional(),
  textColor: z.string().optional(),
  fontSize: finite.positive().optional(),
  fontWeight: finite.min(1).max(1000).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  lineHeight: finite.positive().optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
});
export const nodeSchema: z.ZodType<DesignNode> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['frame', 'rectangle', 'text', 'group', 'instance']),
  screenId: z.string().min(1),
  parentId: z.string().optional(),
  childIds: z.array(z.string()),
  bounds: boundsSchema,
  style: styleSchema,
  text: z.string().optional(),
  clipContent: z.boolean().optional(),
  entityId: z.string().min(1).optional(),
  semantics: z
    .object({
      role: z.string().min(1),
      commitment: z.enum(['ambiguous', 'inferred', 'confirmed']),
      protected: z.boolean().optional(),
    })
    .optional(),
  componentBinding: z
    .object({
      componentId: z.string(),
      props: z.record(z.string(), z.unknown()),
      slot: z.string().min(1).optional(),
    })
    .optional(),
  projectComponent: z
    .object({
      componentId: z.string().min(1),
      role: z.enum(['main', 'instance']),
    })
    .optional(),
  repeaterId: z.string().optional(),
  provenance: z.object({ actor: z.enum(['user', 'agent']), operationId: z.string() }),
});
const transitionSchema: z.ZodType<Transition> = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetScreenId: z.string().min(1),
  label: z.string(),
});
export const projectComponentDefinitionSchema: z.ZodType<ProjectComponentDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  rootId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  nodes: z.record(z.string(), nodeSchema),
  createdAt: finite.nonnegative(),
  updatedAt: finite.nonnegative(),
});
const operationBase = { id: z.string().min(1), actor: z.enum(['user', 'agent']) } as const;
export const operationSchema: z.ZodType<DesignOperation> = z.discriminatedUnion('type', [
  z.object({ ...operationBase, type: z.literal('create'), node: nodeSchema }),
  z.object({
    ...operationBase,
    type: z.literal('move'),
    targetIds: z.array(z.string()).min(1),
    dx: finite,
    dy: finite,
  }),
  z.object({
    ...operationBase,
    type: z.literal('resize'),
    targetId: z.string(),
    bounds: boundsSchema,
  }),
  z.object({ ...operationBase, type: z.literal('delete'), targetIds: z.array(z.string()).min(1) }),
  z.object({
    ...operationBase,
    type: z.literal('repeat'),
    targetIds: z.array(z.string()).min(2),
    repeaterId: z.string(),
  }),
  z.object({
    ...operationBase,
    type: z.literal('bind'),
    targetIds: z.array(z.string()).min(1),
    role: z.string().min(1),
    commitment: z.enum(['ambiguous', 'inferred', 'confirmed']),
  }),
  z.object({ ...operationBase, type: z.literal('transition'), transition: transitionSchema }),
  z.object({
    ...operationBase,
    type: z.literal('promote'),
    targetIds: z.array(z.string()).min(1),
    componentId: z.string(),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...operationBase,
    type: z.literal('style'),
    targetIds: z.array(z.string()).min(1),
    patch: stylePatchSchema,
  }),
  z.object({
    ...operationBase,
    type: z.literal('generalize'),
    sourceId: z.string(),
    targetIds: z.array(z.string()).min(1),
    scope: z.enum(['repeater-siblings', 'component-on-screen']),
    patch: stylePatchSchema,
  }),
  z.object({
    ...operationBase,
    type: z.literal('update-node'),
    targetIds: z.array(z.string()).min(1),
    patch: z
      .object({
        name: z.string().min(1).max(120).optional(),
        text: z.string().max(10000).optional(),
        clipContent: z.boolean().optional(),
      })
      .refine((patch) => Object.keys(patch).length > 0, 'Node patch cannot be empty'),
  }),
  z.object({
    ...operationBase,
    type: z.literal('reparent'),
    targetIds: z.array(z.string()).min(1),
    parentId: z.string().min(1).optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...operationBase,
    type: z.literal('group'),
    targetIds: z.array(z.string()).min(1),
    group: nodeSchema,
  }),
  z.object({
    ...operationBase,
    type: z.literal('ungroup'),
    targetIds: z.array(z.string()).min(1),
  }),
  z.object({
    ...operationBase,
    type: z.literal('reorder'),
    targetIds: z.array(z.string()).min(1),
    direction: z.enum(['forward', 'backward', 'front', 'back']),
  }),
  z.object({
    ...operationBase,
    type: z.literal('duplicate'),
    targetIds: z.array(z.string()).min(1),
    idMap: z.record(z.string(), z.string().min(1)),
    dx: finite,
    dy: finite,
  }),
  z.object({
    ...operationBase,
    type: z.literal('duplicate-screen'),
    sourceScreenId: z.string(),
    screenId: z.string(),
  }),
  z.object({
    ...operationBase,
    type: z.literal('create-branch'),
    sourceScreenId: z.string(),
    branchId: z.string(),
  }),
  z.object({
    ...operationBase,
    type: z.literal('create-project-component'),
    targetId: z.string().min(1),
    definition: projectComponentDefinitionSchema,
  }),
]);

export const observationScopeSchema = z.object({
  kind: z.enum(['selection', 'parent', 'frame', 'screen']),
  rootId: z.string().min(1).optional(),
  nodeIds: z.array(z.string()).min(1),
}) satisfies z.ZodType<ObservationScope>;
export const mutationScopeSchema: z.ZodType<MutationScope> = z.object({
  existingNodeIds: z.array(z.string()),
  insertionParentIds: z.array(z.string()),
  regions: z.array(boundsSchema).min(1),
  allowCreate: z.boolean(),
});
export const generationTargetSchema: z.ZodType<GenerationTarget> = z.object({
  focusNodeIds: z.array(z.string()).min(1),
  observationScope: observationScopeSchema,
  mutationScope: mutationScopeSchema,
});
export const derivationTraceSchema: z.ZodType<DerivationTrace> = z.object({
  observation: z.string().min(1).max(1000),
  context: z.string().min(1).max(1000),
  inference: z.string().min(1).max(1000),
  proposedChange: z.string().min(1).max(1000),
  evidenceNodeIds: z.array(z.string()),
  affectedNodeIds: z.array(z.string()).min(1),
});
const atomicStateSliceSchema: z.ZodType<AtomicStateSlice> = z.object({
  nodes: z.record(z.string(), nodeSchema.nullable()),
  screenRootIds: z.record(z.string(), z.array(z.string())).optional(),
  transitions: z.record(z.string(), transitionSchema.nullable()).optional(),
});
export const atomicChangeSchema: z.ZodType<AtomicChange> = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  preservedFromAtomicChangeId: z.string().optional(),
  operation: operationSchema,
  dependencyIds: z.array(z.string()),
  trace: derivationTraceSchema,
  before: atomicStateSliceSchema,
  after: atomicStateSliceSchema,
});
export const generationRunSchema: z.ZodType<GenerationRun> = z.object({
  id: z.string().min(1),
  sourceRevisionId: z.string().min(1),
  action: z.enum(['complete', 'refine', 'vary', 'resolve']),
  target: generationTargetSchema,
  pinnedNodeIds: z.array(z.string()),
  requestedFidelity: fidelitySchema,
  contextSnapshotId: z.string().optional(),
  contextNodeIds: z.array(z.string()),
  contextRootId: z.string().optional(),
  contextSummarized: z.boolean(),
  snapshot: z
    .object({
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
  candidateIds: z.array(z.string()),
  provider: z.enum(['codex', 'legacy']),
  legacyProvider: z
    .object({
      id: z.literal('local'),
      fallback: z.boolean(),
    })
    .optional(),
  model: z.string().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  contextSchemaVersion: z.string().min(1),
  createdAt: z.number().finite().nonnegative(),
});
export const candidateRevisionSchema: z.ZodType<CandidateRevision> = z.object({
  id: z.string().min(1),
  generationRunId: z.string().min(1),
  sourceRevisionId: z.string().min(1),
  revisionId: z.string().min(1),
  fidelity: fidelitySchema,
  origin: z.literal('ai'),
  atomicChangeIds: z.array(z.string()).min(1),
  decisions: z.record(z.string(), z.enum(['pending', 'accepted', 'rejected'])),
  status: z.enum(['candidate', 'partially-accepted', 'accepted', 'rejected']),
  createdAt: z.number().finite().nonnegative(),
});
export const processEventSchema: z.ZodType<ProcessEvent> = z.object({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: z.enum([
    'legacy-imported',
    'manual-operation',
    'checkpoint-created',
    'generation-requested',
    'generation-failed',
    'generation-cancelled',
    'candidates-generated',
    'candidate-viewed',
    'candidate-rejected',
    'reroll-requested',
    'pin-changed',
    'atomic-decision',
    'candidate-accepted',
    'source-compared',
    'revision-activated',
    'replayed',
    'reverted',
  ]),
  actor: z.enum(['user', 'agent', 'system']),
  timestamp: z.number().finite().nonnegative(),
  revisionId: z.string().optional(),
  generationRunId: z.string().optional(),
  candidateId: z.string().optional(),
  atomicChangeId: z.string().optional(),
  details: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
    )
    .optional(),
});

export const proposalSchema: z.ZodType<ProposedOperation> = z.object({
  id: z.string(),
  baseRevision: z.number().int().nonnegative(),
  targetIds: z.array(z.string()).min(1),
  operation: operationSchema,
  rationale: z.string().max(500),
  confidence: z.number().min(0).max(1),
  source: z.enum(['local', 'codex']),
});

export const defaultStyle: StyleProperties = {
  fill: '#d9dde3',
  opacity: 1,
  radius: 4,
  padding: 12,
  textColor: '#20242b',
  fontSize: 14,
  fontWeight: 400,
  textAlign: 'left',
  lineHeight: 1.4,
  density: 'comfortable',
};

export function blankDocument(): DesignDocument {
  const branch: Branch = { id: 'branch-main', name: 'Accepted', screenIds: ['screen-1'] };
  const canvas: CanvasSnapshot = {
    screens: [{ id: 'screen-1', name: 'Screen 1', rootIds: [], branchId: branch.id }],
    nodes: {},
    transitions: [],
    branches: [branch],
    activeBranchId: branch.id,
    activeScreenId: 'screen-1',
    entities: {},
    representations: {},
    pinnedNodeIds: [],
    frameFidelity: {},
    nodeFidelityOverrides: {},
    projectComponents: {},
  };
  const initialRevision: DesignRevision = {
    id: 'revision-initial',
    status: 'working',
    origin: 'human',
    createdAt: 0,
    operationIds: [],
    atomicChangeIds: [],
    snapshot: structuredClone(canvas),
  };
  return {
    version: 2,
    revision: 0,
    currentRevisionId: initialRevision.id,
    ...canvas,
    revisions: { [initialRevision.id]: initialRevision },
    generationRuns: {},
    candidates: {},
    atomicChanges: {},
    processEvents: [],
    operations: [],
  };
}
