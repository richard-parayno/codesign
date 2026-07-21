import { describe, expect, it } from 'vitest';
import { blankDocument, defaultStyle, type DesignNode, type NodeKind } from '$lib/model/types';
import {
  groupedCanvasContextTarget,
  groupedCanvasSelectionTarget,
  isAdditiveSelectionModifier,
  isCanvasAdditiveSelectionModifier,
  selectedContainerCanvasTarget,
  selectionWithTarget,
} from './selection';

function node(id: string, kind: NodeKind, parentId?: string): DesignNode {
  return {
    id,
    name: id,
    kind,
    screenId: 'screen-1',
    parentId,
    childIds: [],
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    style: { ...defaultStyle },
    provenance: { actor: 'user', operationId: `create-${id}` },
  };
}

describe('grouped canvas selection', () => {
  it('selects the containing group when a child is hit', () => {
    const document = blankDocument();
    document.nodes.group = node('group', 'group');
    document.nodes.child = node('child', 'rectangle', 'group');

    expect(groupedCanvasSelectionTarget(document, 'child')?.id).toBe('group');
  });

  it('selects the nearest group across nested group boundaries', () => {
    const document = blankDocument();
    document.nodes.outer = node('outer', 'group');
    document.nodes.inner = node('inner', 'group', 'outer');
    document.nodes.child = node('child', 'rectangle', 'inner');

    expect(groupedCanvasSelectionTarget(document, 'child')?.id).toBe('inner');
  });

  it('does not promote a directly hit nested container to the root screen frame', () => {
    const document = blankDocument();
    document.nodes.screen = node('screen', 'frame');
    document.nodes.group = node('group', 'group', 'screen');

    expect(groupedCanvasSelectionTarget(document, 'group')?.id).toBe('group');
  });

  it('selects a nested group instead of its root screen frame when a child is hit', () => {
    const document = blankDocument();
    document.nodes.screen = node('screen', 'frame');
    document.nodes.group = node('group', 'group', 'screen');
    document.nodes.child = node('child', 'rectangle', 'group');

    expect(groupedCanvasSelectionTarget(document, 'child')?.id).toBe('group');
  });

  it('keeps the directly hit node for modifier-assisted deep selection', () => {
    const document = blankDocument();
    document.nodes.group = node('group', 'group');
    document.nodes.child = node('child', 'rectangle', 'group');

    expect(groupedCanvasSelectionTarget(document, 'child', true)?.id).toBe('child');
  });

  it('selects the containing frame when a child is hit', () => {
    const document = blankDocument();
    document.nodes.frame = node('frame', 'frame');
    document.nodes.child = node('child', 'rectangle', 'frame');

    expect(groupedCanvasSelectionTarget(document, 'child')?.id).toBe('frame');
  });

  it('keeps a frame child as the target for modifier-assisted deep selection', () => {
    const document = blankDocument();
    document.nodes.frame = node('frame', 'frame');
    document.nodes.child = node('child', 'rectangle', 'frame');

    expect(groupedCanvasSelectionTarget(document, 'child', true)?.id).toBe('child');
  });

  it('keeps an already-selected frame as the drag target when a child is hit', () => {
    const document = blankDocument();
    document.nodes.frame = node('frame', 'frame');
    document.nodes.background = node('background', 'rectangle', 'frame');

    expect(selectedContainerCanvasTarget(document, 'background', ['frame'])?.id).toBe('frame');
  });

  it('does not retain a selected container that is not an ancestor of the hit node', () => {
    const document = blankDocument();
    document.nodes.frame = node('frame', 'frame');
    document.nodes.sibling = node('sibling', 'rectangle');

    expect(selectedContainerCanvasTarget(document, 'sibling', ['frame'])).toBeUndefined();
  });
});

describe('multi-selection modifiers', () => {
  it.each([
    { ctrlKey: true, metaKey: false, shiftKey: false },
    { ctrlKey: false, metaKey: true, shiftKey: false },
    { ctrlKey: false, metaKey: false, shiftKey: true },
  ])('treats Ctrl, Cmd, and Shift as additive selection', (modifier) => {
    expect(isAdditiveSelectionModifier(modifier)).toBe(true);
  });

  it('adds and removes clicked targets without disturbing other selected layers', () => {
    expect(selectionWithTarget(['one'], 'two', true)).toEqual(['one', 'two']);
    expect(selectionWithTarget(['one', 'two'], 'two', true)).toEqual(['one']);
    expect(selectionWithTarget(['one', 'two'], 'three', false)).toEqual(['three']);
  });

  it('reserves Ctrl and Cmd for exclusive deep selection on the canvas', () => {
    expect(
      isCanvasAdditiveSelectionModifier({ ctrlKey: true, metaKey: false, shiftKey: false }),
    ).toBe(false);
    expect(
      isCanvasAdditiveSelectionModifier({ ctrlKey: false, metaKey: true, shiftKey: false }),
    ).toBe(false);
    expect(
      isCanvasAdditiveSelectionModifier({ ctrlKey: false, metaKey: false, shiftKey: true }),
    ).toBe(true);
  });
});

describe('grouped canvas context targeting', () => {
  it('opens the group menu when an unselected child is right-clicked', () => {
    const document = blankDocument();
    document.nodes.group = node('group', 'group');
    document.nodes.child = node('child', 'rectangle', 'group');

    expect(groupedCanvasContextTarget(document, 'child', [])?.id).toBe('group');
    expect(groupedCanvasContextTarget(document, 'child', ['group'])?.id).toBe('group');
  });

  it('preserves a directly selected child menu inside a group', () => {
    const document = blankDocument();
    document.nodes.group = node('group', 'group');
    document.nodes.child = node('child', 'rectangle', 'group');

    expect(groupedCanvasContextTarget(document, 'child', ['child'])?.id).toBe('child');
  });
});
