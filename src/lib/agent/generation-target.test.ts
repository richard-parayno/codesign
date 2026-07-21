import { describe, expect, it } from 'vitest';
import { applyOperationBatch } from '$lib/model/operations';
import { blankDocument, defaultStyle, type DesignNode } from '$lib/model/types';
import {
  commonContainingParentFrame,
  deriveCodesignGenerationTarget,
  deriveCodesignObservationScope,
  deriveCodesignScopeOptions,
  deriveGenerationTarget,
  inspectCodesignEligibility,
} from './generation-target';

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

function codesignScene() {
  return applyOperationBatch(blankDocument(), [
    {
      id: 'create-page',
      type: 'create',
      actor: 'user',
      node: node('page', 'frame', { x: 0, y: 0, width: 1200, height: 800 }),
    },
    {
      id: 'create-search-group',
      type: 'create',
      actor: 'user',
      node: node('search-group', 'group', { x: 40, y: 40, width: 420, height: 56 }, 'page'),
    },
    {
      id: 'create-search-field',
      type: 'create',
      actor: 'user',
      node: node(
        'search-field',
        'rectangle',
        { x: 40, y: 40, width: 420, height: 56 },
        'search-group',
      ),
    },
    {
      id: 'create-search-text',
      type: 'create',
      actor: 'user',
      node: {
        ...node('search-text', 'text', { x: 60, y: 56, width: 100, height: 24 }, 'search-group'),
        text: 'Search',
      },
    },
    {
      id: 'create-results',
      type: 'create',
      actor: 'user',
      node: node('results', 'group', { x: 40, y: 130, width: 800, height: 500 }, 'page'),
    },
    {
      id: 'create-result-row',
      type: 'create',
      actor: 'user',
      node: node('result-row', 'rectangle', { x: 60, y: 160, width: 760, height: 80 }, 'results'),
    },
    {
      id: 'create-dialog',
      type: 'create',
      actor: 'user',
      node: node('dialog', 'frame', { x: 880, y: 40, width: 280, height: 300 }, 'page'),
    },
    {
      id: 'create-dialog-action',
      type: 'create',
      actor: 'user',
      node: node(
        'dialog-action',
        'rectangle',
        { x: 900, y: 260, width: 120, height: 44 },
        'dialog',
      ),
    },
    {
      id: 'create-loose',
      type: 'create',
      actor: 'user',
      node: node('loose', 'rectangle', { x: 1300, y: 20, width: 100, height: 60 }),
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

describe('strict Codesign generation targeting', () => {
  it('offers exactly selection and same-parent-frame scopes', () => {
    const options = deriveCodesignScopeOptions(codesignScene(), ['search-group']);
    expect(options.map((option) => option.kind)).toEqual(['selection', 'same-parent-frame']);
    expect(options.map((option) => option.label)).toEqual(['Selection', 'Same parent frame']);
    expect(options.every((option) => option.scope)).toBe(true);
  });

  it('observes the selected nodes and every descendant for selection scope', () => {
    const scope = deriveCodesignObservationScope(codesignScene(), ['search-group'], 'selection');
    expect(scope).toEqual({
      kind: 'selection',
      rootId: 'search-group',
      nodeIds: ['search-group', 'search-field', 'search-text'],
    });
  });

  it('observes all layers in the nearest frame shared by the selection', () => {
    const document = codesignScene();
    expect(commonContainingParentFrame(document, ['search-field'])?.id).toBe('page');
    const scope = deriveCodesignObservationScope(document, ['search-field'], 'same-parent-frame');
    expect(scope).toEqual({
      kind: 'frame',
      rootId: 'page',
      nodeIds: [
        'page',
        'search-group',
        'search-field',
        'search-text',
        'results',
        'result-row',
        'dialog',
        'dialog-action',
      ],
    });
    expect(scope.nodeIds).not.toContain('loose');
  });

  it('uses the parent frame rather than a selected nested frame itself', () => {
    const document = codesignScene();
    expect(commonContainingParentFrame(document, ['dialog'])?.id).toBe('page');
    expect(deriveCodesignObservationScope(document, ['dialog'], 'same-parent-frame').rootId).toBe(
      'page',
    );
  });

  it('requires every target to be a container or structurally contained in one', () => {
    const document = codesignScene();
    expect(inspectCodesignEligibility(document, ['search-group'])).toMatchObject({
      eligible: true,
      invalidNodeIds: [],
    });
    expect(inspectCodesignEligibility(document, ['search-field'])).toMatchObject({
      eligible: true,
      invalidNodeIds: [],
    });
    expect(inspectCodesignEligibility(document, ['loose'])).toMatchObject({
      eligible: false,
      invalidNodeIds: ['loose'],
      reason: 'Every Codesign target must be a group, a frame, or contained in one.',
    });
    expect(inspectCodesignEligibility(document, ['search-field', 'loose'])).toMatchObject({
      eligible: false,
      invalidNodeIds: ['loose'],
      reason: 'Every Codesign target must be a group, a frame, or contained in one.',
    });
  });

  it('disables both choices for an ineligible target and only frame context when unavailable', () => {
    const document = codesignScene();
    const invalid = deriveCodesignScopeOptions(document, ['loose']);
    expect(invalid).toHaveLength(2);
    expect(invalid.every((option) => option.disabledReason)).toBe(true);

    const rootFrame = deriveCodesignScopeOptions(document, ['page']);
    expect(rootFrame[0].scope?.nodeIds).toContain('search-text');
    expect(rootFrame[1]).toMatchObject({
      kind: 'same-parent-frame',
      disabledReason: 'The selection does not share a containing parent frame.',
    });
  });

  it('keeps mutation within the selected subtree while frame scope enables its container', () => {
    const document = codesignScene();
    const selectionTarget = deriveCodesignGenerationTarget(document, ['search-field'], 'selection');
    expect(selectionTarget.mutationScope).toMatchObject({
      existingNodeIds: ['search-field'],
      insertionParentIds: [],
      allowCreate: false,
    });

    const frameTarget = deriveCodesignGenerationTarget(
      document,
      ['search-field'],
      'same-parent-frame',
    );
    expect(frameTarget.mutationScope).toMatchObject({
      existingNodeIds: ['search-field'],
      insertionParentIds: ['search-group'],
      allowCreate: true,
    });
    expect(frameTarget.observationScope.nodeIds).toContain('search-group');
  });
});
