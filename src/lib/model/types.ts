import { z } from 'zod';

export type Actor = 'user' | 'agent';
export type Commitment = 'ambiguous' | 'inferred' | 'confirmed';
export type NodeKind = 'frame' | 'rectangle' | 'text' | 'group' | 'instance';
export type Agency = 'protect' | 'guide' | 'explore';
export type Bounds = { x: number; y: number; width: number; height: number };
export type StyleProperties = {
  fill: string;
  stroke: string;
  radius: number;
  padding: number;
  textColor: string;
  fontSize: number;
  density?: 'compact' | 'comfortable';
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
  semantics?: { role: string; commitment: Commitment; protected?: boolean };
  componentBinding?: { componentId: string; props: Record<string, unknown> };
  repeaterId?: string;
  provenance: { actor: Actor; operationId: string };
};
export type Screen = { id: string; name: string; rootIds: string[]; branchId: string };
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
      patch: Partial<StyleProperties>;
    }
  | {
      id: string;
      type: 'generalize';
      actor: Actor;
      sourceId: string;
      targetIds: string[];
      scope: 'repeater-siblings' | 'component-on-screen';
      patch: Partial<StyleProperties>;
    }
  | { id: string; type: 'duplicate-screen'; actor: Actor; sourceScreenId: string; screenId: string }
  | { id: string; type: 'create-branch'; actor: Actor; sourceScreenId: string; branchId: string };

export type OperationRecord = DesignOperation & { timestamp: number; summary: string };
export type DesignDocument = {
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
const boundsSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
});
const styleSchema = z.object({
  fill: z.string(),
  stroke: z.string(),
  radius: finite.nonnegative(),
  padding: finite.nonnegative(),
  textColor: z.string(),
  fontSize: finite.positive(),
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
  semantics: z
    .object({
      role: z.string().min(1),
      commitment: z.enum(['ambiguous', 'inferred', 'confirmed']),
      protected: z.boolean().optional(),
    })
    .optional(),
  componentBinding: z
    .object({ componentId: z.string(), props: z.record(z.string(), z.unknown()) })
    .optional(),
  repeaterId: z.string().optional(),
  provenance: z.object({ actor: z.enum(['user', 'agent']), operationId: z.string() }),
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
  z.object({
    ...operationBase,
    type: z.literal('transition'),
    transition: z.object({
      id: z.string(),
      sourceNodeId: z.string(),
      targetScreenId: z.string(),
      label: z.string(),
    }),
  }),
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
    patch: styleSchema.partial(),
  }),
  z.object({
    ...operationBase,
    type: z.literal('generalize'),
    sourceId: z.string(),
    targetIds: z.array(z.string()).min(1),
    scope: z.enum(['repeater-siblings', 'component-on-screen']),
    patch: styleSchema.partial(),
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
]);
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
  stroke: '#a7adb7',
  radius: 4,
  padding: 12,
  textColor: '#20242b',
  fontSize: 14,
  density: 'comfortable',
};
export function blankDocument(): DesignDocument {
  const branch: Branch = { id: 'branch-main', name: 'Accepted', screenIds: ['screen-1'] };
  return {
    version: 1,
    revision: 0,
    screens: [{ id: 'screen-1', name: 'Screen 1', rootIds: [], branchId: branch.id }],
    nodes: {},
    transitions: [],
    branches: [branch],
    activeBranchId: branch.id,
    activeScreenId: 'screen-1',
    hypotheses: [],
    operations: [],
  };
}
