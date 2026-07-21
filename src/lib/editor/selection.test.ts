import { describe, expect, it } from 'vitest';
import { blankDocument, defaultStyle, type DesignNode, type NodeKind } from '$lib/model/types';
import {
  groupedCanvasContextTarget,
  groupedCanvasSelectionTarget,
  isAdditiveSelectionModifier,
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

  it('selects the outermost group across nested group boundaries', () => {
    const document = blankDocument();
    document.nodes.outer = node('outer', 'group');
    document.nodes.inner = node('inner', 'group', 'outer');
    document.nodes.child = node('child', 'rectangle', 'inner');

    expect(groupedCanvasSelectionTarget(document, 'child')?.id).toBe('outer');
  });

  it('keeps the directly hit node for modifier-assisted deep selection', () => {
    const document = blankDocument();
    document.nodes.group = node('group', 'group');
    document.nodes.child = node('child', 'rectangle', 'group');

    expect(groupedCanvasSelectionTarget(document, 'child', true)?.id).toBe('child');
  });

  it('does not promote a child through a frame boundary', () => {
    const document = blankDocument();
    document.nodes.frame = node('frame', 'frame');
    document.nodes.child = node('child', 'rectangle', 'frame');

    expect(groupedCanvasSelectionTarget(document, 'child')?.id).toBe('child');
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
