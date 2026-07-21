import { describe, expect, it } from 'vitest';
import { applyOperationBatch } from '$lib/model/operations';
import { blankDocument, defaultStyle, type DesignNode } from '$lib/model/types';
import { deriveGenerationTarget } from './generation-target';

function node(
  id: string,
  kind: DesignNode['kind'],
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

function scene() {
  return applyOperationBatch(blankDocument(), [
    {
      id: 'create-frame',
      type: 'create',
      actor: 'user',
      node: node('frame', 'frame', { x: 10, y: 20, width: 600, height: 400 }),
    },
    {
      id: 'create-region',
      type: 'create',
      actor: 'user',
      node: node('region', 'rectangle', { x: 30, y: 50, width: 140, height: 300 }, 'frame'),
    },
    {
      id: 'create-content',
      type: 'create',
      actor: 'user',
      node: node('content', 'rectangle', { x: 200, y: 50, width: 380, height: 300 }, 'frame'),
    },
    {
      id: 'create-free',
      type: 'create',
      actor: 'user',
      node: node('free', 'rectangle', { x: 700, y: 40, width: 100, height: 80 }),
    },
  ]);
}

describe('deriveGenerationTarget', () => {
  it('separates focus, whole-frame observation, existing mutation, insertion, and region', () => {
    const target = deriveGenerationTarget(scene(), ['region']);
    expect(target.focusNodeIds).toEqual(['region']);
    expect(target.observationScope).toEqual({
      kind: 'frame',
      rootId: 'frame',
      nodeIds: ['frame', 'region', 'content'],
    });
    expect(target.mutationScope).toEqual({
      existingNodeIds: ['region'],
      insertionParentIds: ['frame'],
      regions: [{ x: 30, y: 50, width: 140, height: 300 }],
      allowCreate: true,
    });
  });

  it('uses a selected frame as both observation root and insertion parent', () => {
    const target = deriveGenerationTarget(scene(), ['frame']);
    expect(target.observationScope.rootId).toBe('frame');
    expect(target.mutationScope.existingNodeIds).toEqual(['frame', 'region', 'content']);
    expect(target.mutationScope.insertionParentIds).toEqual(['frame']);
  });

  it('observes the screen for unframed and cross-frame selections', () => {
    const target = deriveGenerationTarget(scene(), ['free']);
    expect(target.observationScope.kind).toBe('screen');
    expect(target.observationScope.nodeIds).toEqual(['frame', 'region', 'content', 'free']);
    expect(target.mutationScope.insertionParentIds).toEqual([]);
  });

  it('keeps pinned focus observable and geometric but not mutable', () => {
    const document = scene();
    document.pinnedNodeIds = ['region'];
    const target = deriveGenerationTarget(document, ['region']);
    expect(target.focusNodeIds).toEqual(['region']);
    expect(target.mutationScope.existingNodeIds).toEqual([]);
    expect(target.mutationScope.regions).toEqual([document.nodes.region.bounds]);
  });

  it('never uses a pinned container as an insertion parent', () => {
    const document = scene();
    document.pinnedNodeIds = ['frame'];
    const target = deriveGenerationTarget(document, ['frame']);
    expect(target.mutationScope.existingNodeIds).toEqual([]);
    expect(target.mutationScope.insertionParentIds).toEqual([]);
    expect(target.mutationScope.allowCreate).toBe(false);
  });
});
