import { componentCatalog } from '../design-system/registry';
import type {
  Bounds,
  CanvasSnapshot,
  CodesignAction,
  DesignNode,
  Fidelity,
  MutationScope,
  StyleProperties,
} from '../model/types';

export const SCENE_CONTEXT_SCHEMA_VERSION = 'codesign-scene-context-v1';
export const SCENE_CONTEXT_PROMPT_VERSION = 'codesign-scene-generation-v1';
export const DEFAULT_SCENE_DETAIL_LIMIT = 120;

export type SceneContextSnapshotMetadata = {
  snapshotId: string;
  revisionId: string;
  capturedAt: number;
  projectId?: string;
  visual?: {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    sha256: string;
  };
};

export type SceneDesignSystemComponent = {
  id: string;
  name: string;
  importPath: string;
  allowedProps: Record<string, readonly unknown[]>;
  slots: readonly string[];
  kind?: 'root' | 'part';
  rootComponentId?: string;
  editableContent?: boolean;
  allowedChildren?: Readonly<Record<string, readonly string[]>>;
};

export type SceneDesignSystemSnapshot = {
  components: SceneDesignSystemComponent[];
  tokens: Record<string, string | number | boolean>;
  primitiveKinds: Array<'frame' | 'group' | 'rectangle' | 'text' | 'instance'>;
  rawStyleValues: {
    colors: string[];
    radius: number[];
    padding: number[];
    fontSize: number[];
    density: Array<'compact' | 'comfortable'>;
  };
};

export type SceneContextInput = {
  snapshot: CanvasSnapshot;
  focusNodeIds: readonly string[];
  observationNodeIds: readonly string[];
  /** Explicit observation root. Pass null to use the observed-node union as the origin. */
  observationRootId?: string | null;
  mutationTargetIds: readonly string[];
  mutationScope?: MutationScope;
  action: CodesignAction;
  fidelity: Fidelity;
  metadata: SceneContextSnapshotMetadata;
  designSystem?: SceneDesignSystemSnapshot;
  detailLimit?: number;
  schemaVersion?: string;
  promptVersion?: string;
};

export type SceneNodeFidelity = {
  value: Fidelity;
  source: 'node-override' | 'frame' | 'request';
  sourceNodeId?: string;
};

export type SceneNodeSummary = {
  childCount: number;
  textLength: number;
  /** Bounded semantic evidence retained even when visual details are summarized. */
  textPreview?: string;
  fill: string;
  componentId?: string;
};

export type SceneContextNode = {
  id: string;
  name: string;
  kind: DesignNode['kind'];
  screenId: string;
  parentId: string | null;
  childIds: string[];
  /** Bounds in observation-root-relative coordinates. */
  bounds: Bounds;
  absoluteBounds: Bounds;
  zOrder: { global: number; amongSiblings: number; path: number[] };
  detail: 'full' | 'summary';
  fidelity: SceneNodeFidelity;
  provenance: DesignNode['provenance'];
  pinned: boolean;
  clipContent: boolean | null;
  style?: StyleProperties;
  text?: string | null;
  componentBinding?: {
    componentId: string;
    props: Record<string, unknown>;
    slot?: string;
  } | null;
  repeaterId?: string | null;
  summary?: SceneNodeSummary;
};

export type SceneLayoutRegion = {
  parentId: string | null;
  childIds: string[];
  direction: 'empty' | 'horizontal' | 'vertical' | 'overlap' | 'free';
  bounds: Bounds;
  emptySpace: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    estimatedArea: number;
  };
};

export type SceneSiblingRelationship = {
  parentId: string | null;
  beforeId: string;
  afterId: string;
  axis: 'x' | 'y' | 'overlap';
  gap: number;
};

export type SceneContext = {
  schemaVersion: string;
  promptVersion: string;
  snapshot: SceneContextSnapshotMetadata & {
    activeScreenId: string;
    screenName: string;
  };
  request: {
    action: CodesignAction;
    fidelity: Fidelity;
    focusNodeIds: string[];
    observationNodeIds: string[];
    mutationTargetIds: string[];
    mutationScope: MutationScope;
  };
  coordinateSpace: {
    kind: 'observation-root-relative';
    observationRootId: string | null;
    origin: { x: number; y: number };
  };
  screen: {
    id: string;
    name: string;
    rootIds: string[];
    bounds: Bounds;
    roots: Array<{ id: string; bounds: Bounds; absoluteBounds: Bounds; zOrder: number }>;
  };
  nodes: SceneContextNode[];
  layout: {
    regions: SceneLayoutRegion[];
    siblingRelationships: SceneSiblingRelationship[];
  };
  designSystem: SceneDesignSystemSnapshot;
  summarization: {
    applied: boolean;
    strategy: 'none' | 'focus-priority-hierarchy-preserving';
    detailLimit: number;
    detailedNodeCount: number;
    summarizedNodeCount: number;
    summarizedNodeIds: string[];
    explicitDetailCountBeyondLimit: number;
  };
};

type OrderedNode = { node: DesignNode; siblingIndex: number; path: number[] };

function uniqueKnownIds(ids: readonly string[], nodes: Record<string, DesignNode>) {
  return [...new Set(ids)].filter((id) => !!nodes[id]);
}

function stableUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableUnknown);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableUnknown(item)]),
    );
  return value;
}

function stableRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function textPreview(text: string | undefined) {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}

export function defaultDesignSystemSnapshot(): SceneDesignSystemSnapshot {
  return {
    components: componentCatalog
      .flatMap((component) => [
        {
          id: component.id,
          name: component.displayName,
          importPath: component.importPath,
          allowedProps: Object.fromEntries(
            Object.entries(component.props).map(([key, definition]) => [
              key,
              definition.options?.length ? [...definition.options] : [definition.kind],
            ]),
          ),
          slots: component.slots.map((slot) => slot.id),
          kind: 'root' as const,
          editableContent: component.editableContent,
          allowedChildren: Object.fromEntries(
            component.slots.map((slot) => [slot.id, [...slot.accepts]]),
          ),
        },
        ...component.parts.map((part) => ({
          id: part.id,
          name: part.displayName,
          importPath: component.importPath,
          allowedProps: {},
          slots: part.slots.map((slot) => slot.id),
          kind: 'part' as const,
          rootComponentId: component.id,
          editableContent: part.editableContent,
          allowedChildren: Object.fromEntries(
            part.slots.map((slot) => [slot.id, [...slot.accepts]]),
          ),
        })),
      ])
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((component) => ({
        ...component,
        allowedProps: stableRecord(component.allowedProps),
        allowedChildren: stableRecord(component.allowedChildren),
      })),
    tokens: {},
    primitiveKinds: ['frame', 'group', 'rectangle', 'text', 'instance'],
    rawStyleValues: {
      colors: [
        'transparent',
        '#ffffff',
        '#f6f7f9',
        '#eef0f3',
        '#d9dde3',
        '#a7adb7',
        '#747b88',
        '#20242b',
        '#2563eb',
      ],
      radius: [0, 4, 8, 12, 16],
      padding: [0, 4, 8, 12, 16, 24],
      fontSize: [12, 14, 16, 20, 24],
      density: ['compact', 'comfortable'],
    },
  };
}

function orderedScreenNodes(snapshot: CanvasSnapshot, screenId: string): OrderedNode[] {
  const screen = snapshot.screens.find((item) => item.id === screenId);
  const ordered: OrderedNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string, siblingIndex: number, path: number[]) => {
    const node = snapshot.nodes[id];
    if (!node || node.screenId !== screenId || seen.has(id)) return;
    seen.add(id);
    ordered.push({ node, siblingIndex, path });
    node.childIds.forEach((childId, index) => visit(childId, index, [...path, index]));
  };
  (screen?.rootIds ?? []).forEach((id, index) => visit(id, index, [index]));

  // Malformed/orphaned nodes remain visible to the model, but have a stable ordered tail.
  Object.values(snapshot.nodes)
    .filter((node) => node.screenId === screenId && !seen.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((node, index) => visit(node.id, index, [(screen?.rootIds.length ?? 0) + index]));
  return ordered;
}

function unionBounds(values: readonly Bounds[]): Bounds {
  if (!values.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...values.map((bounds) => bounds.x));
  const top = Math.min(...values.map((bounds) => bounds.y));
  const right = Math.max(...values.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...values.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function relativeBounds(bounds: Bounds, origin: { x: number; y: number }): Bounds {
  return { ...bounds, x: bounds.x - origin.x, y: bounds.y - origin.y };
}

function ancestorChain(id: string, nodes: Record<string, DesignNode>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: DesignNode | undefined = nodes[id];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current.id);
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return chain;
}

function commonObservationRoot(
  observationIds: readonly string[],
  nodes: Record<string, DesignNode>,
): string | null {
  const chains = observationIds
    .map((id) => ancestorChain(id, nodes))
    .filter((chain) => chain.length);
  if (!chains.length) return null;
  const shortest = Math.min(...chains.map((chain) => chain.length));
  let common: string | null = null;
  for (let index = 0; index < shortest; index += 1) {
    const candidate = chains[0][index];
    if (chains.every((chain) => chain[index] === candidate)) common = candidate;
    else break;
  }
  return common;
}

function resolvedFidelity(
  node: DesignNode,
  snapshot: CanvasSnapshot,
  requested: Fidelity,
): SceneNodeFidelity {
  const direct = snapshot.nodeFidelityOverrides[node.id];
  if (direct) return { value: direct, source: 'node-override', sourceNodeId: node.id };
  const seen = new Set<string>();
  let current: DesignNode | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const frame = snapshot.frameFidelity[current.id];
    if (frame) return { value: frame, source: 'frame', sourceNodeId: current.id };
    current = current.parentId ? snapshot.nodes[current.parentId] : undefined;
  }
  return { value: requested, source: 'request' };
}

function detailIds(
  ordered: readonly OrderedNode[],
  snapshot: CanvasSnapshot,
  explicitIds: readonly string[],
  observationRootId: string | null,
  limit: number,
) {
  const detail = new Set<string>();
  const roots =
    snapshot.screens.find((screen) => screen.id === snapshot.activeScreenId)?.rootIds ?? [];
  const required = uniqueKnownIds([...roots, ...explicitIds], snapshot.nodes);
  for (const id of required) {
    detail.add(id);
    for (const ancestor of ancestorChain(id, snapshot.nodes)) detail.add(ancestor);
  }
  if (observationRootId) detail.add(observationRootId);

  // Stable paint order fills the remaining budget. Explicit targets are never summarized.
  for (const { node } of ordered) {
    if (detail.size >= Math.max(limit, required.length)) break;
    detail.add(node.id);
  }
  return { detail, requiredCount: detail.size > limit ? detail.size - limit : 0 };
}

function regionDirection(children: readonly DesignNode[]) {
  if (!children.length) return 'empty' as const;
  if (children.length === 1) return 'free' as const;
  let horizontal = true;
  let vertical = true;
  let overlap = false;
  for (let index = 1; index < children.length; index += 1) {
    const before = children[index - 1].bounds;
    const after = children[index].bounds;
    horizontal &&= before.x + before.width <= after.x;
    vertical &&= before.y + before.height <= after.y;
    overlap ||= !(
      before.x + before.width <= after.x ||
      after.x + after.width <= before.x ||
      before.y + before.height <= after.y ||
      after.y + after.height <= before.y
    );
  }
  if (overlap) return 'overlap' as const;
  if (horizontal) return 'horizontal' as const;
  if (vertical) return 'vertical' as const;
  return 'free' as const;
}

function buildLayout(
  ordered: readonly OrderedNode[],
  screenBounds: Bounds,
  origin: { x: number; y: number },
): SceneContext['layout'] {
  const byParent = new Map<string | null, DesignNode[]>();
  for (const { node } of ordered) {
    const key = node.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }
  const nodeById = new Map(ordered.map(({ node }) => [node.id, node]));
  const parentEntries: Array<[string | null, DesignNode[]]> = [
    [null, byParent.get(null) ?? []],
    ...ordered
      .map(({ node }) => [node.id, byParent.get(node.id) ?? []] as [string, DesignNode[]])
      .filter(([, children]) => children.length > 0),
  ];
  const regions: SceneLayoutRegion[] = [];
  const siblingRelationships: SceneSiblingRelationship[] = [];

  for (const [parentId, children] of parentEntries) {
    const parentBounds = parentId ? nodeById.get(parentId)?.bounds : screenBounds;
    if (!parentBounds) continue;
    const occupied = unionBounds(children.map((child) => child.bounds));
    const childArea = children.reduce(
      (sum, child) => sum + child.bounds.width * child.bounds.height,
      0,
    );
    regions.push({
      parentId,
      childIds: children.map((child) => child.id),
      direction: regionDirection(children),
      bounds: relativeBounds(parentBounds, origin),
      emptySpace: {
        left: children.length ? occupied.x - parentBounds.x : 0,
        top: children.length ? occupied.y - parentBounds.y : 0,
        right: children.length
          ? parentBounds.x + parentBounds.width - occupied.x - occupied.width
          : 0,
        bottom: children.length
          ? parentBounds.y + parentBounds.height - occupied.y - occupied.height
          : 0,
        estimatedArea: Math.max(0, parentBounds.width * parentBounds.height - childArea),
      },
    });

    for (let index = 1; index < children.length; index += 1) {
      const before = children[index - 1];
      const after = children[index];
      const xGap = after.bounds.x - (before.bounds.x + before.bounds.width);
      const yGap = after.bounds.y - (before.bounds.y + before.bounds.height);
      const xOverlap = xGap < 0 && after.bounds.x + after.bounds.width > before.bounds.x;
      const yOverlap = yGap < 0 && after.bounds.y + after.bounds.height > before.bounds.y;
      const axis = xOverlap && yOverlap ? 'overlap' : Math.abs(xGap) <= Math.abs(yGap) ? 'x' : 'y';
      siblingRelationships.push({
        parentId,
        beforeId: before.id,
        afterId: after.id,
        axis,
        gap: axis === 'overlap' ? Math.max(xGap, yGap) : axis === 'x' ? xGap : yGap,
      });
    }
  }
  return { regions, siblingRelationships };
}

/** Builds the canonical stable model context used by the scene-generation boundary. */
export function buildSceneContext(input: SceneContextInput): SceneContext {
  const { snapshot } = input;
  const screen = snapshot.screens.find((item) => item.id === snapshot.activeScreenId);
  if (!screen) throw new Error(`Active screen ${snapshot.activeScreenId} does not exist`);
  const focusNodeIds = uniqueKnownIds(input.focusNodeIds, snapshot.nodes);
  const observationNodeIds = uniqueKnownIds(input.observationNodeIds, snapshot.nodes);
  const mutationTargetIds = uniqueKnownIds(input.mutationTargetIds, snapshot.nodes);
  const observed = new Set(observationNodeIds);
  const ordered = orderedScreenNodes(snapshot, screen.id)
    .filter(({ node }) => observed.has(node.id))
    .map(({ node, ...entry }) => ({
      ...entry,
      node: {
        ...node,
        parentId: node.parentId && observed.has(node.parentId) ? node.parentId : undefined,
        childIds: node.childIds.filter((id) => observed.has(id)),
      },
    }));
  if (!ordered.length)
    throw new Error('Observation scope does not contain any active-screen nodes');
  const screenBounds = unionBounds(ordered.map(({ node }) => node.bounds));
  const observationRootId =
    input.observationRootId === undefined
      ? commonObservationRoot(observationNodeIds, snapshot.nodes)
      : input.observationRootId && observed.has(input.observationRootId)
        ? input.observationRootId
        : null;
  const observationRoot = observationRootId ? snapshot.nodes[observationRootId] : undefined;
  const origin = observationRoot
    ? { x: observationRoot.bounds.x, y: observationRoot.bounds.y }
    : { x: screenBounds.x, y: screenBounds.y };
  const detailLimit = Math.max(1, Math.floor(input.detailLimit ?? DEFAULT_SCENE_DETAIL_LIMIT));
  const { detail, requiredCount } = detailIds(
    ordered,
    snapshot,
    [
      ...focusNodeIds,
      ...mutationTargetIds,
      ...ordered.filter(({ node }) => !node.parentId).map(({ node }) => node.id),
    ],
    observationRootId,
    detailLimit,
  );
  const pinned = new Set(snapshot.pinnedNodeIds);
  const nodes: SceneContextNode[] = ordered.map(({ node, siblingIndex, path }, global) => {
    const common = {
      id: node.id,
      name: node.name,
      kind: node.kind,
      screenId: node.screenId,
      parentId: node.parentId ?? null,
      childIds: [...node.childIds],
      bounds: relativeBounds(node.bounds, origin),
      absoluteBounds: { ...node.bounds },
      zOrder: { global, amongSiblings: siblingIndex, path },
      fidelity: resolvedFidelity(node, snapshot, input.fidelity),
      provenance: { ...node.provenance },
      pinned: pinned.has(node.id),
      clipContent: node.clipContent ?? null,
    };
    if (!detail.has(node.id))
      return {
        ...common,
        detail: 'summary' as const,
        summary: {
          childCount: node.childIds.length,
          textLength: node.text?.length ?? 0,
          ...(textPreview(node.text) ? { textPreview: textPreview(node.text) } : {}),
          fill: node.style.fill,
          ...(node.componentBinding ? { componentId: node.componentBinding.componentId } : {}),
        },
      };
    return {
      ...common,
      detail: 'full' as const,
      style: { ...node.style },
      text: node.text ?? null,
      componentBinding: node.componentBinding
        ? {
            componentId: node.componentBinding.componentId,
            props: stableUnknown(node.componentBinding.props) as Record<string, unknown>,
            ...(node.componentBinding.slot ? { slot: node.componentBinding.slot } : {}),
          }
        : null,
      repeaterId: node.repeaterId ?? null,
    };
  });
  const summarizedNodeIds = nodes
    .filter((node) => node.detail === 'summary')
    .map((node) => node.id);
  const roots = nodes
    .filter((node) => node.parentId === null)
    .map((node) => ({
      id: node.id,
      bounds: { ...node.bounds },
      absoluteBounds: { ...node.absoluteBounds },
      zOrder: node.zOrder.amongSiblings,
    }));
  const designSystem = input.designSystem ?? defaultDesignSystemSnapshot();
  const sourceMutationScope = input.mutationScope ?? {
    existingNodeIds: [...mutationTargetIds],
    insertionParentIds: [],
    regions: [],
    allowCreate: false,
  };

  return {
    schemaVersion: input.schemaVersion ?? SCENE_CONTEXT_SCHEMA_VERSION,
    promptVersion: input.promptVersion ?? SCENE_CONTEXT_PROMPT_VERSION,
    snapshot: {
      snapshotId: input.metadata.snapshotId,
      revisionId: input.metadata.revisionId,
      capturedAt: input.metadata.capturedAt,
      ...(input.metadata.projectId ? { projectId: input.metadata.projectId } : {}),
      ...(input.metadata.visual ? { visual: { ...input.metadata.visual } } : {}),
      activeScreenId: screen.id,
      screenName: screen.name,
    },
    request: {
      action: input.action,
      fidelity: input.fidelity,
      focusNodeIds,
      observationNodeIds,
      mutationTargetIds,
      mutationScope: {
        ...sourceMutationScope,
        existingNodeIds: [...sourceMutationScope.existingNodeIds],
        insertionParentIds: [...sourceMutationScope.insertionParentIds],
        regions: sourceMutationScope.regions.map((region) => relativeBounds(region, origin)),
      },
    },
    coordinateSpace: {
      kind: 'observation-root-relative',
      observationRootId,
      origin,
    },
    screen: {
      id: screen.id,
      name: screen.name,
      rootIds: ordered.filter(({ node }) => !node.parentId).map(({ node }) => node.id),
      bounds: relativeBounds(screenBounds, origin),
      roots,
    },
    nodes,
    layout: buildLayout(ordered, screenBounds, origin),
    designSystem: {
      components: [...designSystem.components]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((component) => ({
          ...component,
          allowedProps: stableRecord(component.allowedProps),
          slots: [...component.slots],
        })),
      tokens: stableRecord(designSystem.tokens),
      primitiveKinds: [...designSystem.primitiveKinds],
      rawStyleValues: {
        colors: [...designSystem.rawStyleValues.colors],
        radius: [...designSystem.rawStyleValues.radius],
        padding: [...designSystem.rawStyleValues.padding],
        fontSize: [...designSystem.rawStyleValues.fontSize],
        density: [...designSystem.rawStyleValues.density],
      },
    },
    summarization: {
      applied: summarizedNodeIds.length > 0,
      strategy: summarizedNodeIds.length ? 'focus-priority-hierarchy-preserving' : 'none',
      detailLimit,
      detailedNodeCount: nodes.length - summarizedNodeIds.length,
      summarizedNodeCount: summarizedNodeIds.length,
      summarizedNodeIds,
      explicitDetailCountBeyondLimit: requiredCount,
    },
  };
}
