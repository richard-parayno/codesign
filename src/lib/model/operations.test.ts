import { describe, expect, it } from 'vitest';
import { isDesignDocumentV2 } from './migration';
import { applyOperation, applyOperationBatch, OperationError } from './operations';
import { blankDocument, defaultStyle, type DesignNode } from './types';

function node(id: string, x: number, y: number): DesignNode {
  return {
    id,
    name: id,
    kind: 'rectangle',
    screenId: 'screen-1',
    childIds: [],
    bounds: { x, y, width: 200, height: 48 },
    style: { ...defaultStyle },
    provenance: { actor: 'user', operationId: `create-${id}` },
  };
}

function container(id: string, x: number, y: number, kind: 'frame' | 'group' = 'frame') {
  return {
    ...node(id, x, y),
    kind,
    bounds: { x, y, width: 500, height: 400 },
    clipContent: kind === 'frame' ? false : undefined,
  } satisfies DesignNode;
}

describe('design operations', () => {
  it('starts new primitives without an implicit stroke', () => {
    expect(defaultStyle.stroke).toBeUndefined();
    expect(defaultStyle.strokeWidth).toBeUndefined();
  });

  it('applies the critical create and repeat slice consistently', () => {
    let document = blankDocument();
    document = applyOperation(
      document,
      { id: 'create-a', type: 'create', actor: 'user', node: node('a', 10, 10) },
      1,
    );
    document = applyOperation(
      document,
      { id: 'create-b', type: 'create', actor: 'user', node: node('b', 10, 70) },
      2,
    );
    const repeated = applyOperation(
      document,
      {
        id: 'repeat',
        type: 'repeat',
        actor: 'agent',
        targetIds: ['a', 'b'],
        repeaterId: 'records',
      },
      3,
    );
    expect(repeated.nodes.a.repeaterId).toBe('records');
    expect(repeated.nodes.b.repeaterId).toBe('records');
    expect(repeated.nodes.b.semantics).toBeUndefined();
    expect(() =>
      applyOperation(
        repeated,
        {
          id: 'repeat',
          type: 'repeat',
          actor: 'agent',
          targetIds: ['a', 'b'],
          repeaterId: 'records',
        },
        3,
      ),
    ).toThrow('already applied');
  });

  it('keeps child layers attached when their frame moves', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-frame',
      type: 'create',
      actor: 'user',
      node: {
        ...node('frame', 40, 50),
        kind: 'frame',
        bounds: { x: 40, y: 50, width: 400, height: 300 },
      },
    });
    document = applyOperation(document, {
      id: 'create-child',
      type: 'create',
      actor: 'user',
      node: { ...node('child', 80, 90), parentId: 'frame' },
    });

    expect(document.screens[0].rootIds).toEqual(['frame']);
    expect(document.nodes.frame.childIds).toEqual(['child']);

    const moved = applyOperation(document, {
      id: 'move-frame',
      type: 'move',
      actor: 'user',
      targetIds: ['frame'],
      dx: 25,
      dy: -10,
    });

    expect(moved.nodes.frame.bounds).toMatchObject({ x: 65, y: 40 });
    expect(moved.nodes.child.bounds).toMatchObject({ x: 105, y: 80 });
  });

  it('does not reset omitted properties in a partial style edit', () => {
    const styled = node('styled', 0, 0);
    styled.style = {
      ...styled.style,
      strokeWidth: 3,
      opacity: 0.55,
      fontWeight: 600,
      lineHeight: 1.8,
    };
    const document = applyOperation(blankDocument(), {
      id: 'create-styled',
      type: 'create',
      actor: 'user',
      node: styled,
    });

    const aligned = applyOperation(document, {
      id: 'align-styled',
      type: 'style',
      actor: 'user',
      targetIds: ['styled'],
      patch: { textAlign: 'center' },
    });

    expect(aligned.nodes.styled.style).toMatchObject({
      strokeWidth: 3,
      opacity: 0.55,
      fontWeight: 600,
      lineHeight: 1.8,
      textAlign: 'center',
    });
    expect(aligned.operations.at(-1)).toMatchObject({
      type: 'style',
      patch: { textAlign: 'center' },
    });
  });

  it('can explicitly add and remove stroke properties', () => {
    const document = applyOperation(blankDocument(), {
      id: 'create-plain',
      type: 'create',
      actor: 'user',
      node: node('plain', 0, 0),
    });
    const outlined = applyOperation(document, {
      id: 'add-stroke',
      type: 'style',
      actor: 'user',
      targetIds: ['plain'],
      patch: { stroke: '#20242b', strokeWidth: 2 },
    });
    expect(outlined.nodes.plain.style).toMatchObject({ stroke: '#20242b', strokeWidth: 2 });

    const cleared = applyOperation(outlined, {
      id: 'remove-stroke',
      type: 'style',
      actor: 'user',
      targetIds: ['plain'],
      patch: { stroke: null, strokeWidth: null },
    });
    expect(cleared.nodes.plain.style).not.toHaveProperty('stroke');
    expect(cleared.nodes.plain.style).not.toHaveProperty('strokeWidth');
  });

  it('rejects unknown components and invalid registered props', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-a',
      type: 'create',
      actor: 'user',
      node: node('a', 0, 0),
    });
    expect(() =>
      applyOperation(document, {
        id: 'bad-1',
        type: 'promote',
        actor: 'agent',
        targetIds: ['a'],
        componentId: 'InventedCard',
        props: {},
      }),
    ).toThrow(OperationError);
    expect(() =>
      applyOperation(document, {
        id: 'bad-2',
        type: 'promote',
        actor: 'agent',
        targetIds: ['a'],
        componentId: 'Card',
        props: { density: 'tiny' },
      }),
    ).toThrow('not valid');
  });

  it('keeps supported component density in sync with direct style edits', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-row',
      type: 'create',
      actor: 'user',
      node: node('row', 0, 0),
    });
    document = applyOperation(document, {
      id: 'promote-row',
      type: 'promote',
      actor: 'agent',
      targetIds: ['row'],
      componentId: 'DataRow',
      props: { density: 'comfortable', interactive: true },
    });

    const compact = applyOperation(document, {
      id: 'compact-row',
      type: 'style',
      actor: 'user',
      targetIds: ['row'],
      patch: { density: 'compact', padding: 8 },
    });

    expect(compact.nodes.row.style).toMatchObject({ density: 'compact', padding: 8 });
    expect(compact.nodes.row.componentBinding?.props).toMatchObject({ density: 'compact' });
  });

  it('keeps a source screen isolated when a branch is changed', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-a',
      type: 'create',
      actor: 'user',
      node: node('a', 0, 0),
    });
    document = applyOperation(document, {
      id: 'branch',
      type: 'create-branch',
      actor: 'user',
      sourceScreenId: 'screen-1',
      branchId: 'alternate',
    });
    document = applyOperation(document, {
      id: 'style-alt',
      type: 'style',
      actor: 'user',
      targetIds: ['alternate-screen-node-1'],
      patch: { radius: 12 },
    });
    expect(document.nodes.a.style.radius).toBe(4);
    expect(document.nodes['alternate-screen-node-1'].style.radius).toBe(12);
  });

  it('rejects stale target IDs and protected agent mutations', () => {
    const protectedNode = node('safe', 0, 0);
    protectedNode.semantics = { role: 'shell', commitment: 'confirmed', protected: true };
    const document = applyOperation(blankDocument(), {
      id: 'create-safe',
      type: 'create',
      actor: 'user',
      node: protectedNode,
    });
    expect(() =>
      applyOperation(document, {
        id: 'move-missing',
        type: 'move',
        actor: 'user',
        targetIds: ['gone'],
        dx: 1,
        dy: 1,
      }),
    ).toThrow('no longer exist');
    expect(() =>
      applyOperation(document, {
        id: 'move-safe',
        type: 'move',
        actor: 'agent',
        targetIds: ['safe'],
        dx: 1,
        dy: 1,
      }),
    ).toThrow('pinned');
  });

  it('applies a batch as one revision and leaves the source untouched when any change fails', () => {
    const document = applyOperation(blankDocument(), {
      id: 'create-a',
      type: 'create',
      actor: 'user',
      node: node('a', 0, 0),
    });
    const applied = applyOperationBatch(
      document,
      [
        { id: 'move-a', type: 'move', actor: 'user', targetIds: ['a'], dx: 10, dy: 0 },
        {
          id: 'style-a',
          type: 'style',
          actor: 'user',
          targetIds: ['a'],
          patch: { radius: 12 },
        },
      ],
      { timestamp: 20, transactionId: 'two-edits' },
    );

    expect(applied.revision).toBe(document.revision + 1);
    expect(applied.nodes.a.bounds.x).toBe(10);
    expect(applied.nodes.a.style.radius).toBe(12);
    expect(applied.operations.slice(-2).map((record) => record.transactionId)).toEqual([
      'two-edits',
      'two-edits',
    ]);
    expect(() =>
      applyOperationBatch(document, [
        { id: 'move-valid', type: 'move', actor: 'user', targetIds: ['a'], dx: 10, dy: 0 },
        { id: 'move-invalid', type: 'move', actor: 'user', targetIds: ['missing'], dx: 1, dy: 0 },
      ]),
    ).toThrow('no longer exist');
    expect(document.nodes.a.bounds.x).toBe(0);
    expect(document.operations.some((operation) => operation.id === 'move-valid')).toBe(false);

    const deleted = applyOperation(applied, {
      id: 'delete-a',
      type: 'delete',
      actor: 'user',
      targetIds: ['a'],
    });
    expect(isDesignDocumentV2(deleted)).toBe(true);
  });

  it('deep-duplicates a hierarchy with caller-supplied stable IDs and one offset', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-frame',
      type: 'create',
      actor: 'user',
      node: container('frame', 20, 30),
    });
    document = applyOperation(document, {
      id: 'create-child',
      type: 'create',
      actor: 'user',
      node: {
        ...node('child', 60, 80),
        parentId: 'frame',
        kind: 'instance',
        style: { ...defaultStyle, fill: '#123456', opacity: 0.6, radius: 18 },
        componentBinding: { componentId: 'Card', props: { radius: 'medium' } },
      },
    });
    document = applyOperation(document, {
      id: 'create-grandchild',
      type: 'create',
      actor: 'user',
      node: {
        ...node('grandchild', 72, 96),
        parentId: 'child',
        kind: 'instance',
        text: 'Save',
        componentBinding: { componentId: 'Card.Content', props: {}, slot: 'default' },
      },
    });

    const duplicated = applyOperation(document, {
      id: 'duplicate-tree',
      type: 'duplicate',
      actor: 'user',
      targetIds: ['frame', 'child'],
      idMap: { frame: 'frame-copy', child: 'child-copy', grandchild: 'grandchild-copy' },
      dx: 24,
      dy: 16,
    });

    expect(duplicated.screens[0].rootIds).toEqual(['frame', 'frame-copy']);
    expect(duplicated.nodes['frame-copy']).toMatchObject({
      parentId: undefined,
      childIds: ['child-copy'],
      bounds: { x: 44, y: 46, width: 500, height: 400 },
      clipContent: false,
    });
    expect(duplicated.nodes['child-copy']).toMatchObject({
      parentId: 'frame-copy',
      childIds: ['grandchild-copy'],
      bounds: { x: 84, y: 96 },
      style: { fill: '#123456', opacity: 0.6, radius: 18 },
      componentBinding: {
        componentId: 'Card',
        props: { radius: 'medium' },
      },
    });
    expect(duplicated.nodes['grandchild-copy']).toMatchObject({
      parentId: 'child-copy',
      bounds: { x: 96, y: 112 },
      text: 'Save',
      componentBinding: { componentId: 'Card.Content', props: {}, slot: 'default' },
    });
    expect(duplicated.nodes['child-copy'].entityId).not.toBe(document.nodes.child.entityId);
    expect(duplicated.operations.at(-1)?.summary).toBe('Duplicated 2 nodes');
  });

  it('validates component bindings and slot relationships on create and preserves slots on prop edits', () => {
    expect(() =>
      applyOperation(blankDocument(), {
        id: 'create-unknown-component',
        type: 'create',
        actor: 'user',
        node: {
          ...node('unknown', 0, 0),
          kind: 'instance',
          componentBinding: { componentId: 'Missing', props: {} },
        },
      }),
    ).toThrow('Unknown component');

    let document = applyOperation(blankDocument(), {
      id: 'create-card',
      type: 'create',
      actor: 'user',
      node: {
        ...node('card', 0, 0),
        kind: 'instance',
        componentBinding: { componentId: 'Card', props: { radius: 'medium' } },
      },
    });
    expect(() =>
      applyOperation(document, {
        id: 'create-plain-child',
        type: 'create',
        actor: 'user',
        node: { ...node('plain', 8, 8), parentId: 'card', kind: 'text', text: 'Nope' },
      }),
    ).toThrow('registered component parts');
    expect(() =>
      applyOperation(document, {
        id: 'create-invalid-part',
        type: 'create',
        actor: 'user',
        node: {
          ...node('title', 8, 8),
          parentId: 'card',
          kind: 'instance',
          componentBinding: { componentId: 'Card.Title', props: {}, slot: 'default' },
        },
      }),
    ).toThrow('not allowed');
    document = applyOperation(document, {
      id: 'create-header',
      type: 'create',
      actor: 'user',
      node: {
        ...node('header', 8, 8),
        parentId: 'card',
        kind: 'instance',
        componentBinding: { componentId: 'Card.Header', props: {}, slot: 'default' },
      },
    });
    document = applyOperation(document, {
      id: 'create-title',
      type: 'create',
      actor: 'user',
      node: {
        ...node('title', 12, 12),
        parentId: 'header',
        kind: 'instance',
        text: 'Title',
        componentBinding: { componentId: 'Card.Title', props: {}, slot: 'default' },
      },
    });
    document = applyOperation(document, {
      id: 'edit-title-binding',
      type: 'promote',
      actor: 'user',
      targetIds: ['title'],
      componentId: 'Card.Title',
      props: {},
    });
    expect(document.nodes.title.componentBinding?.slot).toBe('default');
  });

  it('rejects incomplete or colliding stable ID maps without touching the source', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-frame',
      type: 'create',
      actor: 'user',
      node: container('frame', 0, 0),
    });
    document = applyOperation(document, {
      id: 'create-child',
      type: 'create',
      actor: 'user',
      node: { ...node('child', 10, 10), parentId: 'frame' },
    });

    expect(() =>
      applyOperation(document, {
        id: 'bad-map',
        type: 'duplicate',
        actor: 'user',
        targetIds: ['frame'],
        idMap: { frame: 'frame-copy' },
        dx: 10,
        dy: 10,
      }),
    ).toThrow('complete selected hierarchy');
    expect(() =>
      applyOperation(document, {
        id: 'colliding-map',
        type: 'duplicate',
        actor: 'user',
        targetIds: ['frame'],
        idMap: { frame: 'same-copy', child: 'same-copy' },
        dx: 10,
        dy: 10,
      }),
    ).toThrow('unique and unused');
    expect(document.screens[0].rootIds).toEqual(['frame']);
    expect(Object.keys(document.nodes)).toEqual(['frame', 'child']);
  });

  it('reparents and detaches layers without changing their absolute bounds', () => {
    let document = applyOperationBatch(blankDocument(), [
      {
        id: 'create-frame',
        type: 'create',
        actor: 'user',
        node: container('frame', 100, 100),
      },
      { id: 'create-layer', type: 'create', actor: 'user', node: node('layer', 180, 190) },
    ]);
    const originalBounds = structuredClone(document.nodes.layer.bounds);

    document = applyOperation(document, {
      id: 'into-frame',
      type: 'reparent',
      actor: 'user',
      targetIds: ['layer'],
      parentId: 'frame',
      index: 0,
    });
    expect(document.nodes.layer.parentId).toBe('frame');
    expect(document.nodes.layer.bounds).toEqual(originalBounds);
    expect(document.nodes.frame.childIds).toEqual(['layer']);
    expect(document.screens[0].rootIds).toEqual(['frame']);

    document = applyOperation(document, {
      id: 'detach-layer',
      type: 'reparent',
      actor: 'user',
      targetIds: ['layer'],
      index: 0,
    });
    expect(document.nodes.layer.parentId).toBeUndefined();
    expect(document.nodes.layer.bounds).toEqual(originalBounds);
    expect(document.nodes.frame.childIds).toEqual([]);
    expect(document.screens[0].rootIds).toEqual(['layer', 'frame']);
  });

  it('prevents hierarchy cycles and rejects non-container parents', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-outer',
      type: 'create',
      actor: 'user',
      node: container('outer', 0, 0),
    });
    document = applyOperation(document, {
      id: 'create-inner',
      type: 'create',
      actor: 'user',
      node: { ...container('inner', 20, 20), parentId: 'outer' },
    });
    document = applyOperation(document, {
      id: 'create-leaf',
      type: 'create',
      actor: 'user',
      node: node('leaf', 40, 40),
    });

    expect(() =>
      applyOperation(document, {
        id: 'cycle',
        type: 'reparent',
        actor: 'user',
        targetIds: ['outer'],
        parentId: 'inner',
      }),
    ).toThrow('hierarchy cycle');
    expect(() =>
      applyOperation(document, {
        id: 'bad-parent',
        type: 'reparent',
        actor: 'user',
        targetIds: ['outer'],
        parentId: 'leaf',
      }),
    ).toThrow('frames, groups, and component instances');
    expect(document.nodes.outer.parentId).toBeUndefined();
  });

  it('groups and ungroups sibling layers while preserving canvas geometry and stack position', () => {
    let document = applyOperationBatch(blankDocument(), [
      { id: 'create-before', type: 'create', actor: 'user', node: node('before', 0, 0) },
      { id: 'create-a', type: 'create', actor: 'user', node: node('a', 20, 30) },
      { id: 'create-b', type: 'create', actor: 'user', node: node('b', 250, 100) },
      { id: 'create-after', type: 'create', actor: 'user', node: node('after', 500, 0) },
    ]);
    const grouped = applyOperation(document, {
      id: 'group-ab',
      type: 'group',
      actor: 'user',
      targetIds: ['a', 'b'],
      group: container('group-ab-node', 0, 0, 'group'),
    });

    expect(grouped.screens[0].rootIds).toEqual(['before', 'group-ab-node', 'after']);
    expect(grouped.nodes['group-ab-node']).toMatchObject({
      childIds: ['a', 'b'],
      bounds: { x: 20, y: 30, width: 430, height: 118 },
    });
    expect(grouped.nodes.a).toMatchObject({
      parentId: 'group-ab-node',
      bounds: document.nodes.a.bounds,
    });
    expect(grouped.nodes.b).toMatchObject({
      parentId: 'group-ab-node',
      bounds: document.nodes.b.bounds,
    });

    document = applyOperation(grouped, {
      id: 'ungroup-ab',
      type: 'ungroup',
      actor: 'user',
      targetIds: ['group-ab-node'],
    });
    expect(document.screens[0].rootIds).toEqual(['before', 'a', 'b', 'after']);
    expect(document.nodes['group-ab-node']).toBeUndefined();
    expect(document.nodes.a).toMatchObject({ parentId: undefined, bounds: grouped.nodes.a.bounds });
    expect(document.nodes.b).toMatchObject({ parentId: undefined, bounds: grouped.nodes.b.bounds });
  });

  it('reorders one or more layers predictably within their own sibling stack', () => {
    let document = applyOperationBatch(
      blankDocument(),
      ['a', 'b', 'c', 'd'].map((id, index) => ({
        id: `create-${id}`,
        type: 'create' as const,
        actor: 'user' as const,
        node: node(id, index * 10, 0),
      })),
    );
    document = applyOperation(document, {
      id: 'forward-bc',
      type: 'reorder',
      actor: 'user',
      targetIds: ['b', 'c'],
      direction: 'forward',
    });
    expect(document.screens[0].rootIds).toEqual(['a', 'd', 'b', 'c']);
    document = applyOperation(document, {
      id: 'back-c',
      type: 'reorder',
      actor: 'user',
      targetIds: ['c'],
      direction: 'back',
    });
    expect(document.screens[0].rootIds).toEqual(['c', 'a', 'd', 'b']);
    document = applyOperation(document, {
      id: 'front-ad',
      type: 'reorder',
      actor: 'user',
      targetIds: ['a', 'd'],
      direction: 'front',
    });
    expect(document.screens[0].rootIds).toEqual(['c', 'b', 'a', 'd']);
    document = applyOperation(document, {
      id: 'backward-d',
      type: 'reorder',
      actor: 'user',
      targetIds: ['d'],
      direction: 'backward',
    });
    expect(document.screens[0].rootIds).toEqual(['c', 'b', 'd', 'a']);
  });

  it('patches frame and text properties with type-specific validation', () => {
    let document = applyOperationBatch(blankDocument(), [
      {
        id: 'create-frame',
        type: 'create',
        actor: 'user',
        node: container('frame', 0, 0),
      },
      {
        id: 'create-text',
        type: 'create',
        actor: 'user',
        node: { ...node('label', 10, 10), kind: 'text', text: 'Before' },
      },
    ]);
    document = applyOperationBatch(document, [
      {
        id: 'clip-frame',
        type: 'update-node',
        actor: 'user',
        targetIds: ['frame'],
        patch: { clipContent: true, name: 'Clipped frame' },
      },
      {
        id: 'edit-text',
        type: 'update-node',
        actor: 'user',
        targetIds: ['label'],
        patch: { text: 'After' },
      },
      {
        id: 'format-text',
        type: 'style',
        actor: 'user',
        targetIds: ['label'],
        patch: {
          textColor: '#ff0000',
          fontSize: 20,
          fontWeight: 700,
          textAlign: 'center',
          lineHeight: 1.6,
          strokeWidth: 2,
          opacity: 0.75,
        },
      },
    ]);

    expect(document.nodes.frame).toMatchObject({ name: 'Clipped frame', clipContent: true });
    expect(document.nodes.label).toMatchObject({
      text: 'After',
      style: {
        textColor: '#ff0000',
        fontSize: 20,
        fontWeight: 700,
        textAlign: 'center',
        lineHeight: 1.6,
        strokeWidth: 2,
        opacity: 0.75,
      },
    });
    expect(() =>
      applyOperation(document, {
        id: 'clip-text',
        type: 'update-node',
        actor: 'user',
        targetIds: ['label'],
        patch: { clipContent: true },
      }),
    ).toThrow('only be applied to frames');
    expect(() =>
      applyOperation(document, {
        id: 'text-frame',
        type: 'update-node',
        actor: 'user',
        targetIds: ['frame'],
        patch: { text: 'Nope' },
      }),
    ).toThrow('only be applied to text');
  });
});
