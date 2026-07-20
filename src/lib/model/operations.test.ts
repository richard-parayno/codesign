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

describe('design operations', () => {
  it('applies the critical create and repeat slice deterministically', () => {
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
});
