import { describe, expect, it } from 'vitest';
import { demoCheckpoint } from './checkpoint';
import {
  containingFrameForBounds,
  descendantNodeIds,
  orderedScreenNodes,
  screenLayerRows,
} from './layers';
import { applyOperation } from './operations';
import { blankDocument, defaultStyle, type DesignNode, type NodeKind } from './types';

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
    screenId: 'screen-1',
    parentId,
    childIds: [],
    bounds,
    style: { ...defaultStyle },
    provenance: { actor: 'user', operationId: `create-${id}` },
  };
}

describe('layer hierarchy', () => {
  it('renders containers before children and presents the topmost layer stack first', () => {
    let document = blankDocument();
    for (const item of [
      node('frame', 'frame', { x: 0, y: 0, width: 400, height: 300 }),
      node('child-a', 'rectangle', { x: 20, y: 20, width: 80, height: 60 }, 'frame'),
      node('child-b', 'rectangle', { x: 40, y: 40, width: 80, height: 60 }, 'frame'),
      node('top-root', 'rectangle', { x: 450, y: 0, width: 80, height: 60 }),
    ])
      document = applyOperation(document, {
        id: `create-${item.id}`,
        type: 'create',
        actor: 'user',
        node: item,
      });

    expect(orderedScreenNodes(document, 'screen-1').map((item) => item.id)).toEqual([
      'frame',
      'child-a',
      'child-b',
      'top-root',
    ]);
    expect(
      screenLayerRows(document, 'screen-1').map(({ node: item, depth }) => [item.id, depth]),
    ).toEqual([
      ['top-root', 0],
      ['frame', 0],
      ['child-b', 1],
      ['child-a', 1],
    ]);
    expect(descendantNodeIds(document, ['frame'])).toEqual(['frame', 'child-a', 'child-b']);
  });

  it('chooses the deepest topmost frame that fully contains a new layer', () => {
    let document = blankDocument();
    for (const item of [
      node('outer', 'frame', { x: 0, y: 0, width: 500, height: 400 }),
      node('inner', 'frame', { x: 50, y: 50, width: 250, height: 200 }, 'outer'),
    ])
      document = applyOperation(document, {
        id: `create-${item.id}`,
        type: 'create',
        actor: 'user',
        node: item,
      });
    const paintOrder = orderedScreenNodes(document, 'screen-1');

    expect(containingFrameForBounds(paintOrder, { x: 80, y: 80, width: 100, height: 80 })?.id).toBe(
      'inner',
    );
    expect(
      containingFrameForBounds(paintOrder, { x: 280, y: 220, width: 100, height: 80 })?.id,
    ).toBe('outer');
    expect(
      containingFrameForBounds(paintOrder, { x: 480, y: 380, width: 100, height: 80 }),
    ).toBeUndefined();
  });

  it('ships the demo checkpoint with its visible layers nested under the application frame', () => {
    const document = demoCheckpoint();
    expect(document.screens[0].rootIds).toEqual(['frame']);
    expect(document.nodes.frame.childIds).toEqual([
      'sidebar',
      'header',
      'content',
      'row-1',
      'row-2',
      'row-3',
      'row-4',
    ]);
  });
});
