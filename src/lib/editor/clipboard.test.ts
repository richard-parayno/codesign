import { describe, expect, it } from 'vitest';
import { applyOperationBatch } from '$lib/model/operations';
import {
  blankDocument,
  defaultStyle,
  type DesignDocument,
  type DesignNode,
  type NodeKind,
} from '$lib/model/types';
import {
  ClipboardError,
  CODESIGN_CLIPBOARD_FORMAT,
  CODESIGN_CLIPBOARD_VERSION,
  createClipboardPayload,
  deserializeClipboardPayload,
  materializeClipboard,
  serializeClipboardPayload,
  type ClipboardIdFactory,
} from './clipboard';

function node(
  id: string,
  kind: NodeKind,
  bounds: DesignNode['bounds'],
  parentId?: string,
): DesignNode {
  return {
    id,
    name: id,
    kind,
    screenId: 'source-screen',
    parentId,
    childIds: [],
    bounds,
    style: { ...defaultStyle },
    provenance: { actor: 'user', operationId: `create-${id}` },
  };
}

function sourceDocument() {
  const document = blankDocument();
  document.activeScreenId = 'source-screen';
  document.screens[0].id = 'source-screen';
  document.branches[0].screenIds = ['source-screen'];
  let next = document;
  const frame = node('frame', 'frame', { x: 100, y: 80, width: 400, height: 300 });
  frame.style = { ...frame.style, fill: '#101820', radius: 18, padding: 24 };
  const rectangle = node(
    'rectangle',
    'rectangle',
    { x: 124, y: 130, width: 180, height: 90 },
    'frame',
  );
  rectangle.repeaterId = 'source-repeater';
  const label = node('label', 'text', { x: 140, y: 150, width: 120, height: 28 }, 'rectangle');
  label.text = 'Copied label';
  label.style = { ...label.style, textColor: '#fefefe', fontSize: 18 };
  label.componentBinding = {
    componentId: 'Button',
    props: { label: 'Continue', nested: { emphasis: true } },
  };
  label.entityId = 'source-entity';
  for (const item of [frame, rectangle, label])
    next = applyOperationBatch(next, [
      { id: `create-${item.id}`, type: 'create', actor: 'user', node: item },
    ]);
  return next;
}

function destinationDocument() {
  const document = blankDocument();
  document.activeScreenId = 'destination-screen';
  document.screens[0].id = 'destination-screen';
  document.branches[0].screenIds = ['destination-screen'];
  return applyOperationBatch(document, [
    {
      id: 'create-destination-frame',
      type: 'create',
      actor: 'user',
      node: {
        ...node('destination-frame', 'frame', { x: 0, y: 0, width: 1200, height: 900 }),
        screenId: 'destination-screen',
      },
    },
  ]);
}

const ids: ClipboardIdFactory = (kind, sourceId, index) => `${kind}-copy-${index}-${sourceId}`;

describe('editor clipboard', () => {
  it('copies selected roots deeply once and round-trips a versioned JSON payload', () => {
    const source = sourceDocument();
    const payload = createClipboardPayload(source, ['label', 'frame', 'rectangle', 'frame']);

    expect(payload).toMatchObject({
      format: CODESIGN_CLIPBOARD_FORMAT,
      version: CODESIGN_CLIPBOARD_VERSION,
      rootIds: ['frame'],
      sourceParentByRootId: { frame: null },
    });
    expect(Object.keys(payload.nodes)).toEqual(['frame', 'rectangle', 'label']);
    expect(payload.nodes.frame.childIds).toEqual(['rectangle']);
    expect(payload.nodes.rectangle.childIds).toEqual(['label']);
    expect(payload.nodes.label).toMatchObject({
      text: 'Copied label',
      style: { textColor: '#fefefe', fontSize: 18 },
      componentBinding: {
        componentId: 'Button',
        props: { label: 'Continue', nested: { emphasis: true } },
      },
    });

    expect(deserializeClipboardPayload(serializeClipboardPayload(payload))).toEqual(payload);
  });

  it('records external source parents so same-document paste can preserve hierarchy', () => {
    const source = sourceDocument();
    const payload = createClipboardPayload(source, ['rectangle']);
    expect(payload.sourceParentByRootId).toEqual({ rectangle: 'frame' });

    const materialized = materializeClipboard(payload, {
      destination: source,
      destinationScreenId: 'source-screen',
      destinationParentByRootId: payload.sourceParentByRootId,
      offset: { x: 16, y: 16 },
      idFactory: ids,
    });
    expect(materialized.operations[0].node.parentId).toBe('frame');
  });

  it('materializes parent-first creates for one atomic batch in another project', () => {
    const payload = createClipboardPayload(sourceDocument(), ['frame']);
    const destination = destinationDocument();
    const materialized = materializeClipboard(payload, {
      destination,
      destinationScreenId: 'destination-screen',
      destinationParentId: 'destination-frame',
      offset: { x: 24, y: 12 },
      idFactory: ids,
    });

    expect(materialized.createdRootIds).toEqual(['node-copy-0-frame']);
    expect(materialized.bounds).toEqual({ x: 124, y: 92, width: 400, height: 300 });
    expect(materialized.operations.map((operation) => operation.node.id)).toEqual([
      'node-copy-0-frame',
      'node-copy-1-rectangle',
      'node-copy-2-label',
    ]);
    expect(materialized.operations.map((operation) => operation.node.childIds)).toEqual([
      [],
      [],
      [],
    ]);

    const pasted = applyOperationBatch(destination, materialized.operations, {
      transactionId: 'paste-transaction',
    });
    const frame = pasted.nodes['node-copy-0-frame'];
    const rectangle = pasted.nodes['node-copy-1-rectangle'];
    const label = pasted.nodes['node-copy-2-label'];
    expect(frame).toMatchObject({
      screenId: 'destination-screen',
      parentId: 'destination-frame',
      childIds: ['node-copy-1-rectangle'],
      bounds: { x: 124, y: 92, width: 400, height: 300 },
      style: { fill: '#101820', radius: 18, padding: 24 },
    });
    expect(rectangle).toMatchObject({
      parentId: frame.id,
      childIds: [label.id],
      bounds: { x: 148, y: 142, width: 180, height: 90 },
      repeaterId: 'repeater-copy-0-source-repeater',
    });
    expect(label).toMatchObject({
      parentId: rectangle.id,
      text: 'Copied label',
      componentBinding: {
        componentId: 'Button',
        props: { label: 'Continue', nested: { emphasis: true } },
      },
    });
    expect(label.entityId).not.toBe('source-entity');
    expect(pasted.operations.slice(-3).map((operation) => operation.transactionId)).toEqual([
      'paste-transaction',
      'paste-transaction',
      'paste-transaction',
    ]);
  });

  it('maps each copied root to an eligible destination parent or the screen root', () => {
    const source = sourceDocument();
    const second = node('second-root', 'rectangle', {
      x: 600,
      y: 100,
      width: 80,
      height: 60,
    });
    const withSecond = applyOperationBatch(source, [
      { id: 'create-second-root', type: 'create', actor: 'user', node: second },
    ]);
    const payload = createClipboardPayload(withSecond, ['frame', 'second-root']);
    const destination = destinationDocument();
    const materialized = materializeClipboard(payload, {
      destination,
      destinationScreenId: 'destination-screen',
      destinationParentId: 'destination-frame',
      destinationParentByRootId: { 'second-root': null },
      offset: { x: 0, y: 0 },
      idFactory: ids,
    });

    expect(
      materialized.operations.find((operation) => operation.node.name === 'frame')?.node.parentId,
    ).toBe('destination-frame');
    expect(
      materialized.operations.find((operation) => operation.node.name === 'second-root')?.node
        .parentId,
    ).toBeUndefined();

    const invalidParent = {
      ...destination,
      nodes: {
        ...destination.nodes,
        ordinaryRectangle: {
          ...node('ordinaryRectangle', 'rectangle', { x: 0, y: 0, width: 20, height: 20 }),
          screenId: 'destination-screen',
        },
      },
    };
    expect(() =>
      materializeClipboard(payload, {
        destination: invalidParent,
        destinationScreenId: 'destination-screen',
        destinationParentId: 'ordinaryRectangle',
        idFactory: ids,
      }),
    ).toThrow('not an eligible container');
  });

  it('rejects unsupported, malformed, and cyclic clipboard input safely', () => {
    expect(() => deserializeClipboardPayload('not json')).toThrow(ClipboardError);
    expect(() =>
      deserializeClipboardPayload(
        JSON.stringify({ format: CODESIGN_CLIPBOARD_FORMAT, version: 2, rootIds: [], nodes: {} }),
      ),
    ).toThrow('not a supported Codesign payload');

    const payload = createClipboardPayload(sourceDocument(), ['frame']);
    const cyclic = structuredClone(payload);
    cyclic.nodes.label.childIds = ['frame'];
    cyclic.nodes.frame.parentId = 'label';
    expect(() => deserializeClipboardPayload(JSON.stringify(cyclic))).toThrow(ClipboardError);
  });

  it('rejects IDs that collide with the destination or within a paste transaction', () => {
    const payload = createClipboardPayload(sourceDocument(), ['frame']);
    const destination = destinationDocument();
    expect(() =>
      materializeClipboard(payload, {
        destination,
        destinationScreenId: 'destination-screen',
        idFactory: () => 'destination-frame',
      }),
    ).toThrow('duplicate node ID');
    expect(() =>
      materializeClipboard(payload, {
        destination,
        destinationScreenId: 'destination-screen',
        idFactory: (kind) => (kind === 'node' ? 'same-node' : 'same-operation'),
      }),
    ).toThrow(ClipboardError);
  });
});
