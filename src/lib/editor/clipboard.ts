import { z } from 'zod';
import {
  nodeSchema,
  type Bounds,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
} from '$lib/model/types';

export const CODESIGN_CLIPBOARD_FORMAT = 'application/x-codesign-nodes+json' as const;
export const CODESIGN_CLIPBOARD_VERSION = 1 as const;
export const DEFAULT_PASTE_OFFSET = { x: 16, y: 16 } as const;

export class ClipboardError extends Error {}

export type CodesignClipboardPayload = {
  format: typeof CODESIGN_CLIPBOARD_FORMAT;
  version: typeof CODESIGN_CLIPBOARD_VERSION;
  rootIds: string[];
  /** Original external parents, used when pasting back into the same document. */
  sourceParentByRootId: Record<string, string | null>;
  nodes: Record<string, DesignNode>;
};

export type ClipboardIdKind = 'node' | 'operation' | 'repeater';
export type ClipboardIdFactory = (kind: ClipboardIdKind, sourceId: string, index: number) => string;

type DestinationDocument = Pick<DesignDocument, 'screens' | 'nodes' | 'operations'>;

export type MaterializeClipboardOptions = {
  destination: DestinationDocument;
  destinationScreenId: string;
  /** Default eligible parent for every copied root. */
  destinationParentId?: string;
  /** Per-root overrides, keyed by source root ID. `null` explicitly pastes at screen root. */
  destinationParentByRootId?: Record<string, string | null | undefined>;
  offset?: { x: number; y: number };
  idFactory: ClipboardIdFactory;
};

export type ClipboardCreateOperation = Extract<DesignOperation, { type: 'create' }>;

export type MaterializedClipboard = {
  operations: ClipboardCreateOperation[];
  createdRootIds: string[];
  idMap: Record<string, string>;
  bounds: Bounds;
};

const payloadSchema = z
  .object({
    format: z.literal(CODESIGN_CLIPBOARD_FORMAT),
    version: z.literal(CODESIGN_CLIPBOARD_VERSION),
    rootIds: z.array(z.string().min(1)).min(1),
    sourceParentByRootId: z.record(z.string(), z.string().nullable()).default({}),
    nodes: z.record(z.string(), nodeSchema),
  })
  .strict();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(message: string): never {
  throw new ClipboardError(message);
}

function finiteOffset(offset: { x: number; y: number }) {
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
    fail('Paste offset must contain finite coordinates');
}

function parsePayload(value: unknown) {
  const result = payloadSchema.safeParse(value);
  if (!result.success) fail('Clipboard data is not a supported Codesign payload');
  return assertValidPayload(result.data);
}

function assertJsonSerializable(value: unknown, seen = new Set<object>()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    fail('Clipboard payload contains a non-finite number');
  }
  if (typeof value !== 'object') fail('Clipboard payload contains a non-JSON value');
  if (seen.has(value)) fail('Clipboard payload contains a circular value');
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => assertJsonSerializable(item, seen));
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      fail('Clipboard payload contains a non-JSON object');
    Object.values(value).forEach((item) => {
      // JSON intentionally omits absent optional object fields represented as `undefined`.
      if (item !== undefined) assertJsonSerializable(item, seen);
    });
  }
  seen.delete(value);
}

function selectedRoots(document: Pick<DesignDocument, 'screens' | 'nodes'>, selectedIds: string[]) {
  const selected = new Set(selectedIds);
  if (!selected.size) fail('Copy needs at least one selected node');
  for (const id of selected) if (!document.nodes[id]) fail(`Selected node does not exist: ${id}`);

  const rootSet = new Set<string>();
  for (const id of selected) {
    const ancestors = new Set<string>();
    let parentId = document.nodes[id].parentId;
    while (parentId) {
      if (ancestors.has(parentId)) fail('Cannot copy a cyclic layer hierarchy');
      ancestors.add(parentId);
      if (selected.has(parentId)) break;
      parentId = document.nodes[parentId]?.parentId;
    }
    if (!parentId || !selected.has(parentId)) rootSet.add(id);
  }
  if (!rootSet.size) fail('Cannot copy a cyclic layer hierarchy');

  // Derive roots from source layer order instead of click order, preserving sibling z-order.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (rootSet.has(id)) ordered.push(id);
    for (const childId of document.nodes[id]?.childIds ?? []) visit(childId);
  };
  for (const screen of document.screens) for (const id of screen.rootIds) visit(id);
  for (const id of selectedIds) if (!seen.has(id)) visit(id);
  return ordered;
}

function assertValidPayload(payload: CodesignClipboardPayload): CodesignClipboardPayload {
  if (!payload.rootIds.length) fail('Clipboard needs at least one root');
  if (new Set(payload.rootIds).size !== payload.rootIds.length)
    fail('Clipboard roots must be unique');

  for (const [key, node] of Object.entries(payload.nodes)) {
    if (key !== node.id) fail('Clipboard node keys must match their IDs');
    if (new Set(node.childIds).size !== node.childIds.length)
      fail(`Clipboard node has duplicate children: ${node.id}`);
    if (node.parentId && !payload.nodes[node.parentId])
      fail(`Clipboard node references an external parent: ${node.id}`);
    for (const childId of node.childIds) {
      const child = payload.nodes[childId];
      if (!child) fail(`Clipboard node references a missing child: ${childId}`);
      if (child.parentId !== node.id)
        fail(`Clipboard parent and child references disagree: ${node.id}`);
    }
  }

  const reached = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    const node = payload.nodes[id];
    if (!node) fail(`Clipboard root does not exist: ${id}`);
    if (active.has(id)) fail('Clipboard layer hierarchy contains a cycle');
    if (reached.has(id)) fail(`Clipboard node is reachable more than once: ${id}`);
    active.add(id);
    reached.add(id);
    for (const childId of node.childIds) visit(childId);
    active.delete(id);
  };
  for (const rootId of payload.rootIds) {
    if (payload.nodes[rootId]?.parentId) fail(`Clipboard root has a parent: ${rootId}`);
    visit(rootId);
  }
  if (reached.size !== Object.keys(payload.nodes).length)
    fail('Clipboard contains nodes outside its copied roots');
  return payload;
}

/** Creates a self-contained payload from selected roots and all descendants. */
export function createClipboardPayload(
  document: Pick<DesignDocument, 'screens' | 'nodes'>,
  selectedIds: string[],
): CodesignClipboardPayload {
  const rootIds = selectedRoots(document, selectedIds);
  const roots = new Set(rootIds);
  const nodes: Record<string, DesignNode> = {};
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) fail('Cannot copy a cyclic layer hierarchy');
    if (nodes[id]) return;
    const source = document.nodes[id];
    if (!source) fail(`Copied node references a missing descendant: ${id}`);
    active.add(id);
    const copied = clone(source);
    copied.parentId = roots.has(id) ? undefined : copied.parentId;
    nodes[id] = copied;
    for (const childId of copied.childIds) visit(childId);
    active.delete(id);
  };
  rootIds.forEach(visit);
  return assertValidPayload({
    format: CODESIGN_CLIPBOARD_FORMAT,
    version: CODESIGN_CLIPBOARD_VERSION,
    rootIds,
    sourceParentByRootId: Object.fromEntries(
      rootIds.map((id) => [id, document.nodes[id].parentId ?? null]),
    ),
    nodes,
  });
}

export function serializeClipboardPayload(payload: CodesignClipboardPayload): string {
  const valid = parsePayload(payload);
  assertJsonSerializable(valid);
  try {
    return JSON.stringify(valid);
  } catch {
    return fail('Clipboard payload is not JSON serializable');
  }
}

export function deserializeClipboardPayload(value: string): CodesignClipboardPayload {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsePayload(parsed);
  } catch (error) {
    if (error instanceof ClipboardError) throw error;
    return fail('Clipboard data is not valid JSON');
  }
}

export function isEligibleClipboardParent(
  destination: Pick<DesignDocument, 'nodes'>,
  parentId: string,
  screenId: string,
) {
  const parent = destination.nodes[parentId];
  return Boolean(
    parent && parent.screenId === screenId && (parent.kind === 'frame' || parent.kind === 'group'),
  );
}

function payloadBounds(payload: CodesignClipboardPayload, offset: { x: number; y: number }) {
  const nodes = Object.values(payload.nodes);
  const left = Math.min(...nodes.map((node) => node.bounds.x)) + offset.x;
  const top = Math.min(...nodes.map((node) => node.bounds.y)) + offset.y;
  const right = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.width)) + offset.x;
  const bottom = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.height)) + offset.y;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Converts clipboard data into parent-first create operations for one applyOperationBatch call.
 * Root parent mapping uses source root IDs so the same payload can target another project.
 */
export function materializeClipboard(
  input: CodesignClipboardPayload,
  options: MaterializeClipboardOptions,
): MaterializedClipboard {
  const payload = parsePayload(input);
  const offset = options.offset ?? DEFAULT_PASTE_OFFSET;
  finiteOffset(offset);
  if (!options.destination.screens.some((screen) => screen.id === options.destinationScreenId))
    fail('Destination screen does not exist');

  const rootSet = new Set(payload.rootIds);
  const nodeOrder: string[] = [];
  const visit = (id: string) => {
    nodeOrder.push(id);
    for (const childId of payload.nodes[id].childIds) visit(childId);
  };
  payload.rootIds.forEach(visit);

  const idMap: Record<string, string> = {};
  const usedIds = new Set(Object.keys(options.destination.nodes));
  nodeOrder.forEach((sourceId, index) => {
    const id = options.idFactory('node', sourceId, index);
    if (!id || usedIds.has(id)) fail(`Clipboard ID factory returned a duplicate node ID: ${id}`);
    usedIds.add(id);
    idMap[sourceId] = id;
  });

  const repeaterMap = new Map<string, string>();
  const operationIds = new Set(options.destination.operations.map((operation) => operation.id));
  const operations: ClipboardCreateOperation[] = [];
  nodeOrder.forEach((sourceId, index) => {
    const source = payload.nodes[sourceId];
    const operationId = options.idFactory('operation', sourceId, index);
    if (!operationId || operationIds.has(operationId))
      fail(`Clipboard ID factory returned a duplicate operation ID: ${operationId}`);
    operationIds.add(operationId);

    let parentId: string | undefined;
    if (rootSet.has(sourceId)) {
      const mapped = options.destinationParentByRootId?.[sourceId];
      parentId = mapped === null ? undefined : (mapped ?? options.destinationParentId);
      if (
        parentId &&
        !isEligibleClipboardParent(options.destination, parentId, options.destinationScreenId)
      )
        fail(`Clipboard destination parent is not an eligible container: ${parentId}`);
    } else parentId = source.parentId ? idMap[source.parentId] : undefined;

    let repeaterId: string | undefined;
    if (source.repeaterId) {
      repeaterId = repeaterMap.get(source.repeaterId);
      if (!repeaterId) {
        repeaterId = options.idFactory('repeater', source.repeaterId, repeaterMap.size);
        if (!repeaterId) fail('Clipboard ID factory returned an empty repeater ID');
        repeaterMap.set(source.repeaterId, repeaterId);
      }
    }

    const node: DesignNode = {
      ...clone(source),
      id: idMap[sourceId],
      screenId: options.destinationScreenId,
      parentId,
      childIds: [],
      bounds: {
        ...source.bounds,
        x: source.bounds.x + offset.x,
        y: source.bounds.y + offset.y,
      },
      entityId: undefined,
      repeaterId,
      provenance: { actor: 'user', operationId },
    };
    operations.push({ id: operationId, type: 'create', actor: 'user', node });
  });

  return {
    operations,
    createdRootIds: payload.rootIds.map((id) => idMap[id]),
    idMap,
    bounds: payloadBounds(payload, offset),
  };
}
