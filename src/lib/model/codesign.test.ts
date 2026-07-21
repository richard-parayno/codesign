import { describe, expect, it } from 'vitest';
import {
  acceptCandidateChanges,
  activateRevision,
  compareWithSource,
  effectiveFidelity,
  rejectCandidate,
  replayCandidate,
  setFrameFidelity,
  setNodeFidelityOverride,
  setNodePinned,
  setAtomicChangePinned,
  stageCandidates,
  stageGenerationRun,
  viewCandidate,
} from './codesign';
import { isDesignDocumentV2 } from './migration';
import { applyOperation } from './operations';
import {
  blankDocument,
  defaultStyle,
  type AtomicChange,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type GenerationRun,
} from './types';

function node(id: string, kind: DesignNode['kind'], parentId?: string): DesignNode {
  return {
    id,
    name: id,
    kind,
    screenId: 'screen-1',
    parentId,
    childIds: [],
    bounds: {
      x: kind === 'frame' ? 0 : 20,
      y: kind === 'frame' ? 0 : 20,
      width: kind === 'frame' ? 600 : 200,
      height: kind === 'frame' ? 500 : 48,
    },
    style: { ...defaultStyle },
    provenance: { actor: 'agent', operationId: `create-${id}` },
  };
}

function baseDocument() {
  return applyOperation(blankDocument(), {
    id: 'create-frame',
    type: 'create',
    actor: 'user',
    node: { ...node('frame', 'frame'), provenance: { actor: 'user', operationId: 'create-frame' } },
  });
}

function run(document: DesignDocument): GenerationRun {
  return {
    id: 'run-1',
    sourceRevisionId: document.currentRevisionId,
    action: 'complete',
    target: {
      focusNodeIds: ['frame'],
      observationScope: { kind: 'frame', rootId: 'frame', nodeIds: ['frame'] },
      mutationScope: {
        existingNodeIds: ['frame'],
        insertionParentIds: ['frame'],
        regions: [{ ...document.nodes.frame.bounds }],
        allowCreate: true,
      },
    },
    pinnedNodeIds: [],
    requestedFidelity: 'component',
    contextNodeIds: ['frame'],
    contextRootId: 'frame',
    contextSummarized: false,
    candidateIds: [],
    provider: 'codex',
    reasoningEffort: 'high',
    promptVersion: 'visual-autocomplete-v1',
    schemaVersion: '2',
    contextSchemaVersion: 'codesign-scene-context-v1',
    createdAt: 10,
  };
}

function createChange(
  document: DesignDocument,
  candidateId: string,
  changeId: string,
  created: DesignNode,
  dependencyIds: string[],
) {
  const operation: DesignOperation = {
    id: `staged-${changeId}`,
    type: 'create',
    actor: 'agent',
    node: created,
  };
  const parentId = created.parentId!;
  const after = applyOperation(document, operation, 11);
  const change: AtomicChange = {
    id: changeId,
    candidateId,
    operation,
    dependencyIds,
    trace: {
      observation: 'A bounded frame is visible.',
      context: 'The frame has available space.',
      inference: 'Codesign proposed a plausible continuation.',
      proposedChange: `Create ${created.name}.`,
      evidenceNodeIds: ['frame'],
      affectedNodeIds: [created.id],
    },
    before: {
      nodes: { [parentId]: structuredClone(document.nodes[parentId]), [created.id]: null },
    },
    after: {
      nodes: {
        [parentId]: structuredClone(after.nodes[parentId]),
        [created.id]: structuredClone(after.nodes[created.id]),
      },
    },
  };
  return { change, after };
}

function stagedCandidate() {
  const source = baseDocument();
  let document = stageGenerationRun(source, run(source), 10);
  const container = createChange(
    source,
    'candidate-1',
    'change-container',
    node('container', 'group', 'frame'),
    [],
  );
  const navigation = createChange(
    container.after,
    'candidate-1',
    'change-navigation',
    node('navigation', 'rectangle', 'container'),
    ['change-container'],
  );
  const profile = createChange(
    navigation.after,
    'candidate-1',
    'change-profile',
    node('profile', 'rectangle', 'container'),
    ['change-container'],
  );
  document = stageCandidates(
    document,
    'run-1',
    [
      {
        id: 'candidate-1',
        fidelity: 'component',
        atomicChanges: [container.change, navigation.change, profile.change],
      },
    ],
    12,
  );
  return { source, document };
}

describe('Codesign candidate foundation', () => {
  it('stages scoped child creation without mutating the source canvas', () => {
    const { source, document } = stagedCandidate();

    expect(source.nodes.container).toBeUndefined();
    expect(document.nodes.container).toBeUndefined();
    expect(document.candidates['candidate-1'].atomicChangeIds).toEqual([
      'change-container',
      'change-navigation',
      'change-profile',
    ]);
    expect(
      document.revisions[document.candidates['candidate-1'].revisionId].snapshot.nodes,
    ).toHaveProperty('navigation');
    expect(isDesignDocumentV2(document)).toBe(true);
    expect(document.processEvents.map((event) => event.type)).toEqual([
      'manual-operation',
      'checkpoint-created',
      'generation-requested',
      'candidates-generated',
    ]);
  });

  it('keeps nested component identities and slots from ghost revision through acceptance', () => {
    const source = baseDocument();
    let document = stageGenerationRun(source, run(source), 10);
    const cardNode = {
      ...node('card', 'instance', 'frame'),
      componentBinding: {
        componentId: 'Card',
        props: { density: 'compact', radius: 'small' },
      },
    };
    const card = createChange(source, 'candidate-components', 'change-card', cardNode, []);
    const headerNode = {
      ...node('card-header', 'instance', 'card'),
      componentBinding: { componentId: 'Card.Header', props: {}, slot: 'default' },
    };
    const header = createChange(card.after, 'candidate-components', 'change-header', headerNode, [
      'change-card',
    ]);
    const titleNode = {
      ...node('card-title', 'instance', 'card-header'),
      text: 'Account overview',
      componentBinding: { componentId: 'Card.Title', props: {}, slot: 'default' },
    };
    const title = createChange(header.after, 'candidate-components', 'change-title', titleNode, [
      'change-header',
    ]);
    document = stageCandidates(
      document,
      'run-1',
      [
        {
          id: 'candidate-components',
          fidelity: 'component',
          atomicChanges: [card.change, header.change, title.change],
        },
      ],
      12,
    );
    const candidate = document.candidates['candidate-components'];
    const ghost = document.revisions[candidate.revisionId].snapshot;
    expect(ghost.nodes['card-title']).toMatchObject({
      parentId: 'card-header',
      text: 'Account overview',
      componentBinding: { componentId: 'Card.Title', slot: 'default' },
    });

    const accepted = acceptCandidateChanges(
      document,
      candidate.id,
      candidate.atomicChangeIds,
      [],
      13,
    );
    expect(accepted.nodes['card-title']).toMatchObject({
      id: ghost.nodes['card-title'].id,
      parentId: ghost.nodes['card-title'].parentId,
      bounds: ghost.nodes['card-title'].bounds,
      text: ghost.nodes['card-title'].text,
      componentBinding: ghost.nodes['card-title'].componentBinding,
    });
    expect(accepted.nodes['card-title'].entityId).toBe(ghost.nodes['card-title'].entityId);
    expect(accepted.nodes.card.childIds).toEqual(['card-header']);
    expect(accepted.nodes['card-header'].childIds).toEqual(['card-title']);
  });

  it('accepts a dependency-closed subset transactionally with fresh operation IDs', () => {
    const { document } = stagedCandidate();
    const accepted = acceptCandidateChanges(
      document,
      'candidate-1',
      ['change-navigation'],
      ['change-profile'],
      20,
    );

    expect(accepted.nodes.container).toBeDefined();
    expect(accepted.nodes.navigation).toBeDefined();
    expect(accepted.nodes.profile).toBeUndefined();
    expect(accepted.revision).toBe(document.revision + 1);
    expect(accepted.candidates['candidate-1'].status).toBe('partially-accepted');
    expect(accepted.frameFidelity.frame).toBe('component');
    expect(accepted.revisions[document.currentRevisionId].snapshot.frameFidelity).toEqual(
      document.revisions[document.currentRevisionId].snapshot.frameFidelity,
    );
    expect(accepted.revisions[document.currentRevisionId].snapshot.nodeFidelityOverrides).toEqual(
      document.revisions[document.currentRevisionId].snapshot.nodeFidelityOverrides,
    );
    expect(
      accepted.entities[accepted.nodes.frame.entityId!].representationIds
        .map((id) => accepted.representations[id])
        .some(
          (representation) =>
            representation.fidelity === 'component' &&
            representation.revisionId === accepted.currentRevisionId,
        ),
    ).toBe(true);
    expect(accepted.candidates['candidate-1'].decisions).toEqual({
      'change-container': 'accepted',
      'change-navigation': 'accepted',
      'change-profile': 'rejected',
    });
    const applied = accepted.operations.slice(-2);
    expect(new Set(applied.map((operation) => operation.transactionId)).size).toBe(1);
    expect(applied.map((operation) => operation.sourceAtomicChangeId)).toEqual([
      'change-container',
      'change-navigation',
    ]);
    expect(applied.every((operation) => operation.id.startsWith('accept-candidate-1'))).toBe(true);
    expect(isDesignDocumentV2(accepted)).toBe(true);
    expect(() => rejectCandidate(accepted, 'candidate-1')).toThrow('pending candidate');
    expect(() => acceptCandidateChanges(accepted, 'candidate-1', ['change-navigation'])).toThrow(
      'already been decided',
    );
  });

  it('revalidates pins and stale source revisions at acceptance', () => {
    const { document } = stagedCandidate();
    const pinned = setNodePinned(document, 'frame', true, 15);
    expect(() => acceptCandidateChanges(pinned, 'candidate-1', ['change-container'])).toThrow(
      'pinned',
    );

    const changed = applyOperation(document, {
      id: 'manual-move',
      type: 'move',
      actor: 'user',
      targetIds: ['frame'],
      dx: 1,
      dy: 0,
    });
    expect(() => acceptCandidateChanges(changed, 'candidate-1', ['change-container'])).toThrow(
      'stale',
    );
  });

  it('revalidates creation permission and editable regions in the model', () => {
    const { document } = stagedCandidate();
    const candidate = document.candidates['candidate-1'];
    const change = document.atomicChanges['change-container'];

    const disallowed = structuredClone(document);
    disallowed.generationRuns[candidate.generationRunId].target.mutationScope.allowCreate = false;
    expect(() => acceptCandidateChanges(disallowed, candidate.id, [change.id])).toThrow(
      'creation is disabled',
    );

    const outside = structuredClone(document);
    const operation = outside.atomicChanges[change.id].operation;
    if (operation.type !== 'create') throw new Error('Expected create operation');
    operation.node.bounds.x = 700;
    expect(() => acceptCandidateChanges(outside, candidate.id, [change.id])).toThrow(
      'editable region',
    );
  });

  it('rejects a pinned insertion parent when staging a generation run', () => {
    const document = baseDocument();
    expect(() =>
      stageGenerationRun(document, { ...run(document), pinnedNodeIds: ['frame'] }),
    ).toThrow('Pinned nodes cannot be insertion parents');
  });

  it('preserves rejected candidates and compares or replays without a model call', () => {
    const { document } = stagedCandidate();
    const viewed = viewCandidate(document, 'candidate-1', 15);
    const comparison = compareWithSource(viewed, 'candidate-1', 16);
    expect(comparison.source.nodes.container).toBeUndefined();
    expect(comparison.candidate.nodes.container).toBeDefined();

    const rejected = rejectCandidate(comparison.document, 'candidate-1', 17);
    expect(rejected.candidates['candidate-1'].status).toBe('rejected');
    expect(rejected.atomicChanges['change-navigation']).toBeDefined();
    const replayed = replayCandidate(rejected, 'candidate-1', ['change-navigation'], 18);
    expect(replayed.nodes.container).toBeDefined();
    expect(replayed.nodes.navigation).toBeDefined();
    expect(replayed.processEvents.at(-1)?.type).toBe('replayed');
  });

  it('inherits named fidelity from the closest frame and honors node overrides', () => {
    let document = baseDocument();
    document = applyOperation(document, {
      id: 'create-child',
      type: 'create',
      actor: 'user',
      node: {
        ...node('child', 'rectangle', 'frame'),
        provenance: { actor: 'user', operationId: 'create-child' },
      },
    });
    document = setFrameFidelity(document, 'frame', 'visual');
    expect(effectiveFidelity(document, 'child')).toBe('visual');
    document = setNodeFidelityOverride(document, 'child', 'structure');
    expect(effectiveFidelity(document, 'child')).toBe('structure');
    document = setNodeFidelityOverride(document, 'child');
    expect(effectiveFidelity(document, 'child')).toBe('visual');
  });

  it('persists atomic pins as process events and activates recorded revisions', () => {
    const { source, document } = stagedCandidate();
    const pinned = setAtomicChangePinned(document, 'change-navigation', true, 14);
    expect(pinned.processEvents.at(-1)).toMatchObject({
      type: 'pin-changed',
      atomicChangeId: 'change-navigation',
      details: { pinned: true },
    });

    const activated = activateRevision(pinned, source.currentRevisionId, 15);
    expect(activated.currentRevisionId).toBe(source.currentRevisionId);
    expect(activated.processEvents.at(-1)?.type).toBe('revision-activated');
  });
});
