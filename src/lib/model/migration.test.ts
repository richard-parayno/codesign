import { describe, expect, it } from 'vitest';
import {
  isDesignDocumentV2,
  isLegacyDesignDocumentV1,
  migrateDocumentV1,
  migrateProjectEnvelopeV1,
  recoverProjectEnvelopeV2,
} from './migration';
import { blankDocument, defaultStyle, type DesignNode, type LegacyDesignDocumentV1 } from './types';

function legacyNode(id: string, parentId?: string): DesignNode {
  return {
    id,
    name: id,
    kind: id === 'frame' ? 'frame' : 'instance',
    screenId: 'screen-1',
    parentId,
    childIds: id === 'frame' ? ['row'] : [],
    bounds: { x: 0, y: 0, width: id === 'frame' ? 600 : 300, height: 80 },
    style: { ...defaultStyle },
    semantics: {
      role: id === 'frame' ? 'app-shell' : 'record',
      commitment: 'confirmed',
      protected: id === 'row',
    },
    componentBinding:
      id === 'row'
        ? { componentId: 'DataRow', props: { density: 'comfortable', interactive: true } }
        : undefined,
    provenance: { actor: id === 'row' ? 'agent' : 'user', operationId: `create-${id}` },
  };
}

function legacyDocument(): LegacyDesignDocumentV1 {
  const blank = blankDocument();
  return {
    version: 1,
    revision: 4,
    screens: [{ ...blank.screens[0], rootIds: ['frame'] }],
    nodes: { frame: legacyNode('frame'), row: legacyNode('row', 'frame') },
    transitions: [],
    branches: structuredClone(blank.branches),
    activeBranchId: blank.activeBranchId,
    activeScreenId: blank.activeScreenId,
    hypotheses: [
      {
        id: 'hypothesis-1',
        targetIds: ['row'],
        kind: 'component-match',
        confidence: 0.9,
        status: 'accepted',
        evidence: ['legacy evidence'],
      },
    ],
    operations: [],
  };
}

describe('v1 to v2 migration', () => {
  it('preserves canvas state while archiving, rather than promoting, intent-era data', () => {
    const legacy = legacyDocument();
    const migrated = migrateDocumentV1(legacy, 'malleable.projects.v1', 100);

    expect(migrated.version).toBe(2);
    expect(migrated.revision).toBe(4);
    expect(migrated.nodes.row.semantics).toBeUndefined();
    expect(migrated.legacyArchive?.document.hypotheses).toEqual(legacy.hypotheses);
    expect(migrated.legacyArchive?.document.nodes.row.semantics?.role).toBe('record');
    expect(migrated.pinnedNodeIds).toEqual(['row']);
    expect(migrated.frameFidelity).toEqual({ frame: 'wireframe' });
    expect(migrated.nodeFidelityOverrides).toEqual({ row: 'component' });
    expect(migrated.representations['representation-v1-row']).toMatchObject({
      entityId: 'entity-v1-row',
      fidelity: 'component',
      origin: 'ai',
    });
    expect(migrated.processEvents).toHaveLength(1);
    expect(migrated.processEvents[0]).toMatchObject({
      type: 'legacy-imported',
      details: { hypothesisCount: 1, semanticNodeCount: 2 },
    });
    expect(isDesignDocumentV2(migrated)).toBe(true);
  });

  it('migrates project metadata deterministically', () => {
    const envelope = migrateProjectEnvelopeV1(
      {
        version: 1,
        activeProjectId: 'two',
        projects: [
          { id: 'one', name: 'One', document: legacyDocument() },
          { id: 'two', name: 'Two', document: legacyDocument() },
        ],
      },
      'malleable.projects.v1',
      100,
    );

    expect(envelope.version).toBe(2);
    expect(envelope.activeProjectId).toBe('two');
    expect(envelope.projects.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ]);
    expect(envelope.projects[0].document.currentRevisionId).toBe('revision-v1-4');
  });

  it('recovers generation runs written before focus and mutation scopes were separated', () => {
    const document = migrateDocumentV1(legacyDocument(), 'malleable.projects.v1', 100);
    (document.generationRuns as Record<string, unknown>)['legacy-run'] = {
      id: 'legacy-run',
      sourceRevisionId: document.currentRevisionId,
      action: 'complete',
      observationScope: { kind: 'page', nodeIds: ['frame', 'row'] },
      mutationScopeIds: ['frame'],
      pinnedNodeIds: [],
      requestedFidelity: 'component',
      candidateIds: [],
      backend: 'local',
      promptVersion: 'legacy-prompt',
      schemaVersion: 'legacy-schema',
      createdAt: 100,
    };
    const recovered = recoverProjectEnvelopeV2({
      version: 2,
      activeProjectId: 'project',
      projects: [{ id: 'project', name: 'Project', document }],
    });

    expect(recovered).not.toBeNull();
    expect(recovered?.projects[0].document.generationRuns['legacy-run']).toMatchObject({
      target: {
        focusNodeIds: ['frame'],
        observationScope: { kind: 'screen', nodeIds: ['frame', 'row'] },
        mutationScope: {
          existingNodeIds: ['frame'],
          insertionParentIds: ['frame'],
          allowCreate: true,
        },
      },
      provider: 'local',
      contextSummarized: false,
      fallback: false,
    });
  });

  it('rejects structurally broken v1 documents before migration', () => {
    const broken = { ...legacyDocument(), screens: [] };
    expect(isLegacyDesignDocumentV1(broken)).toBe(false);
    expect(() => migrateDocumentV1(broken as LegacyDesignDocumentV1, 'legacy')).toThrow('invalid');
  });
});
