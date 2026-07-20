import { describe, expect, it } from 'vitest';
import { defaultStyle, type CanvasSnapshot, type DesignNode } from '../model/types';
import { SCENE_CONTEXT_FIXTURES } from './fixtures/scene-context-fixtures';
import {
  SCENE_CONTEXT_PROMPT_VERSION,
  SCENE_CONTEXT_SCHEMA_VERSION,
  buildSceneContext,
  type SceneContextInput,
} from './scene-context';

function node(
  id: string,
  parentId: string | undefined,
  childIds: string[],
  x: number,
  y: number,
  width = 100,
  height = 60,
): DesignNode {
  return {
    id,
    name: id,
    kind: childIds.length ? 'frame' : 'rectangle',
    screenId: 'screen',
    parentId,
    childIds,
    bounds: { x, y, width, height },
    style: { ...defaultStyle, fill: `#${id.length.toString().padStart(6, '0')}` },
    provenance: { actor: 'user', operationId: `create-${id}` },
  };
}

function snapshot(nodes: DesignNode[], rootIds: string[]): CanvasSnapshot {
  return {
    screens: [{ id: 'screen', name: 'Test screen', rootIds, branchId: 'branch' }],
    nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
    transitions: [],
    branches: [{ id: 'branch', name: 'Main', screenIds: ['screen'] }],
    activeBranchId: 'branch',
    activeScreenId: 'screen',
    entities: {},
    representations: {},
    pinnedNodeIds: [],
    frameFidelity: {},
    nodeFidelityOverrides: {},
  };
}

function input(
  scene: CanvasSnapshot,
  overrides: Partial<SceneContextInput> = {},
): SceneContextInput {
  return {
    snapshot: scene,
    focusNodeIds: [],
    observationNodeIds: [],
    mutationTargetIds: [],
    action: 'complete',
    fidelity: 'visual',
    metadata: {
      snapshotId: 'snapshot-1',
      revisionId: 'revision-8',
      capturedAt: 1234,
      projectId: 'project-1',
    },
    ...overrides,
  };
}

describe('buildSceneContext', () => {
  it('includes the complete hierarchy in stable bottom-to-top paint order', () => {
    const scene = snapshot(
      [
        node('root-a', undefined, ['child-a', 'child-b'], 0, 0, 500, 400),
        node('child-a', 'root-a', [], 20, 20),
        {
          ...node('child-b', 'root-a', [], 20, 100),
          kind: 'instance',
          text: 'Bound content',
          componentBinding: {
            componentId: 'Card',
            props: { radius: 'medium', density: 'compact' },
          },
        },
        node('root-b', undefined, [], 540, 0, 200, 400),
      ],
      ['root-a', 'root-b'],
    );
    scene.pinnedNodeIds = ['child-b'];
    scene.frameFidelity = { 'root-a': 'component' };
    scene.nodeFidelityOverrides = { 'child-b': 'production' };

    const context = buildSceneContext(
      input(scene, {
        focusNodeIds: ['child-b'],
        observationNodeIds: ['root-a', 'child-a', 'child-b', 'root-b'],
        mutationTargetIds: ['child-b'],
        designSystem: {
          components: [
            {
              id: 'Zeta',
              name: 'Zeta',
              importPath: 'zeta',
              allowedProps: { z: [true], a: ['yes'] },
              slots: ['default'],
            },
            {
              id: 'Alpha',
              name: 'Alpha',
              importPath: 'alpha',
              allowedProps: {},
              slots: [],
            },
          ],
          tokens: { zSpacing: 12, aColor: '#fff' },
          primitiveKinds: ['frame', 'group', 'rectangle', 'text', 'instance'],
          rawStyleValues: {
            colors: ['#fff'],
            radius: [0],
            padding: [0],
            fontSize: [14],
            density: ['comfortable'],
          },
        },
      }),
    );

    expect(context.schemaVersion).toBe(SCENE_CONTEXT_SCHEMA_VERSION);
    expect(context.promptVersion).toBe(SCENE_CONTEXT_PROMPT_VERSION);
    expect(context.nodes.map((item) => item.id)).toEqual([
      'root-a',
      'child-a',
      'child-b',
      'root-b',
    ]);
    expect(context.nodes.map((item) => item.zOrder)).toEqual([
      { global: 0, amongSiblings: 0, path: [0] },
      { global: 1, amongSiblings: 0, path: [0, 0] },
      { global: 2, amongSiblings: 1, path: [0, 1] },
      { global: 3, amongSiblings: 1, path: [1] },
    ]);
    expect(context.nodes.every((item) => item.detail === 'full')).toBe(true);
    expect(context.nodes.find((item) => item.id === 'child-b')).toMatchObject({
      text: 'Bound content',
      pinned: true,
      fidelity: { value: 'production', source: 'node-override', sourceNodeId: 'child-b' },
      componentBinding: {
        componentId: 'Card',
        props: { density: 'compact', radius: 'medium' },
      },
      provenance: { actor: 'user', operationId: 'create-child-b' },
    });
    expect(context.nodes.find((item) => item.id === 'child-a')?.fidelity).toEqual({
      value: 'component',
      source: 'frame',
      sourceNodeId: 'root-a',
    });
    expect(context.designSystem.components.map((component) => component.id)).toEqual([
      'Alpha',
      'Zeta',
    ]);
    expect(Object.keys(context.designSystem.components[1].allowedProps)).toEqual(['a', 'z']);
    expect(Object.keys(context.designSystem.tokens)).toEqual(['aColor', 'zSpacing']);
    expect(context.designSystem.primitiveKinds).toContain('group');
    expect(context.designSystem.rawStyleValues.colors).toEqual(['#fff']);
  });

  it('expresses every node and screen root relative to the deepest common observation root', () => {
    const scene = snapshot(
      [
        node('page', undefined, ['panel'], 100, 50, 900, 700),
        node('panel', 'page', ['nested'], 180, 140, 500, 400),
        node('nested', 'panel', ['leaf'], 220, 200, 240, 180),
        node('leaf', 'nested', [], 250, 230, 80, 40),
      ],
      ['page'],
    );
    const context = buildSceneContext(
      input(scene, {
        observationNodeIds: ['nested', 'leaf'],
        focusNodeIds: ['leaf'],
        mutationTargetIds: ['leaf'],
      }),
    );

    expect(context.coordinateSpace).toEqual({
      kind: 'observation-root-relative',
      observationRootId: 'nested',
      origin: { x: 220, y: 200 },
    });
    expect(context.nodes.find((item) => item.id === 'nested')?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 240,
      height: 180,
    });
    expect(context.nodes.find((item) => item.id === 'leaf')?.bounds).toEqual({
      x: 30,
      y: 30,
      width: 80,
      height: 40,
    });
    expect(context.screen.roots[0]).toMatchObject({
      id: 'nested',
      bounds: { x: 0, y: 0, width: 240, height: 180 },
      absoluteBounds: { x: 220, y: 200, width: 240, height: 180 },
    });
  });

  it('uses the observed union origin when a multi-selection has no explicit root', () => {
    const scene = snapshot(
      [
        node('page', undefined, ['left', 'right'], 100, 50, 900, 700),
        node('left', 'page', [], 220, 160, 100, 60),
        node('right', 'page', [], 520, 260, 120, 80),
      ],
      ['page'],
    );
    const context = buildSceneContext(
      input(scene, {
        observationNodeIds: ['left', 'right'],
        observationRootId: null,
        focusNodeIds: ['left', 'right'],
        mutationTargetIds: ['left', 'right'],
      }),
    );

    expect(context.coordinateSpace).toEqual({
      kind: 'observation-root-relative',
      observationRootId: null,
      origin: { x: 220, y: 160 },
    });
    expect(context.screen.bounds).toEqual({ x: 0, y: 0, width: 420, height: 180 });
    expect(context.nodes.find((item) => item.id === 'right')?.bounds).toMatchObject({
      x: 300,
      y: 100,
    });
  });

  it('keeps focus, observation, mutation targets, roots, and their ancestors detailed', () => {
    const scene = snapshot(
      [
        node('root', undefined, ['section', 'unrelated-a', 'unrelated-b'], 0, 0, 900, 700),
        node('section', 'root', ['focus'], 20, 20, 400, 300),
        { ...node('focus', 'section', [], 40, 40), text: 'Important details' },
        node('unrelated-a', 'root', [], 500, 20),
        node('unrelated-b', 'root', [], 500, 120),
      ],
      ['root'],
    );
    const context = buildSceneContext(
      input(scene, {
        focusNodeIds: ['focus'],
        observationNodeIds: ['root', 'section', 'focus', 'unrelated-a', 'unrelated-b'],
        mutationTargetIds: ['focus'],
        detailLimit: 2,
      }),
    );

    expect(
      ['root', 'section', 'focus'].map(
        (id) => context.nodes.find((item) => item.id === id)?.detail,
      ),
    ).toEqual(['full', 'full', 'full']);
    expect(context.nodes.find((item) => item.id === 'focus')?.text).toBe('Important details');
    expect(context.nodes.find((item) => item.id === 'unrelated-a')).toMatchObject({
      detail: 'summary',
      summary: { childCount: 0, textLength: 0 },
    });
    expect(context.summarization).toMatchObject({
      applied: true,
      strategy: 'focus-priority-hierarchy-preserving',
      detailedNodeCount: 3,
      summarizedNodeCount: 2,
      explicitDetailCountBeyondLimit: 1,
    });
  });

  it('bounds large-scene detail while preserving every node, root region, and hierarchy link', () => {
    const nodes: DesignNode[] = [];
    const roots: string[] = [];
    for (let region = 0; region < 4; region += 1) {
      const rootId = `region-${region}`;
      const childIds = Array.from({ length: 70 }, (_, index) => `${rootId}-item-${index}`);
      roots.push(rootId);
      nodes.push(node(rootId, undefined, childIds, region * 400, 0, 360, 900));
      childIds.forEach((id, index) =>
        nodes.push(node(id, rootId, [], region * 400 + 20, 20 + index * 12, 320, 10)),
      );
    }
    const scene = snapshot(nodes, roots);
    const request = input(scene, {
      focusNodeIds: ['region-3-item-69'],
      observationNodeIds: nodes.map((item) => item.id),
      mutationTargetIds: ['region-3-item-69'],
      detailLimit: 12,
    });
    const first = buildSceneContext(request);
    const second = buildSceneContext(request);

    expect(first).toEqual(second);
    expect(first.nodes).toHaveLength(284);
    expect(first.screen.rootIds).toEqual(roots);
    expect(first.screen.roots.map((root) => root.id)).toEqual(roots);
    expect(roots.map((id) => first.nodes.find((item) => item.id === id)?.detail)).toEqual([
      'full',
      'full',
      'full',
      'full',
    ]);
    expect(first.nodes.find((item) => item.id === 'region-3-item-69')?.detail).toBe('full');
    expect(first.nodes.find((item) => item.id === 'region-0')?.childIds).toHaveLength(70);
    expect(first.summarization.applied).toBe(true);
    expect(first.summarization.detailedNodeCount).toBeLessThanOrEqual(12);
    expect(first.summarization.summarizedNodeCount).toBeGreaterThan(250);
  });

  it('builds useful canonical context for generic product scenes', () => {
    expect(SCENE_CONTEXT_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'dashboard',
      'profile-card',
      'form-settings',
      'table-filter',
      'card-grid-onboarding',
    ]);

    for (const fixture of SCENE_CONTEXT_FIXTURES) {
      const context = buildSceneContext(
        input(fixture.snapshot, {
          focusNodeIds: fixture.focusNodeIds,
          observationNodeIds: Object.keys(fixture.snapshot.nodes),
          mutationTargetIds: fixture.mutationTargetIds,
          action: 'complete',
          fidelity: 'component',
        }),
      );
      expect(context.nodes).toHaveLength(Object.keys(fixture.snapshot.nodes).length);
      expect(context.request.focusNodeIds).toEqual(fixture.focusNodeIds);
      expect(context.request.mutationTargetIds).toEqual(fixture.mutationTargetIds);
      expect(context.coordinateSpace.observationRootId).toBe(fixture.observationNodeIds[0]);
      expect(context.layout.regions.length).toBeGreaterThan(1);
      expect(context.designSystem.components.map((component) => component.id)).toContain('Button');
      expect(context.summarization.applied).toBe(false);
    }
  });
});
