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
    expect(accepted.nodes.frame.projectComponent).toEqual({
      componentId: 'project-component-codesign-frame',
      role: 'main',
    });
    expect(accepted.nodes.frame.name).toBe('Card');
    expect(accepted.projectComponents?.['project-component-codesign-frame']).toMatchObject({
      id: 'project-component-codesign-frame',
      name: 'Card',
      rootId: 'frame',
      sourceNodeId: 'frame',
      createdAt: 13,
      updatedAt: 13,
    });
    expect(
      accepted.projectComponents?.['project-component-codesign-frame'].nodes['card-title']
        .componentBinding,
    ).toEqual(ghost.nodes['card-title'].componentBinding);
    expect(
      accepted.revisions[accepted.currentRevisionId].snapshot.projectComponents?.[
        'project-component-codesign-frame'
      ],
    ).toEqual(accepted.projectComponents?.['project-component-codesign-frame']);
    expect(
      accepted.revisions[accepted.currentRevisionId].snapshot.nodes.frame.projectComponent,
    ).toEqual(accepted.nodes.frame.projectComponent);
  });

  it('refreshes the same local component definition on later component acceptances', () => {
    const source = baseDocument();
    let document = stageGenerationRun(source, run(source), 10);
    const buttonNode = {
      ...node('button', 'instance', 'frame'),
      componentBinding: { componentId: 'Button', props: { variant: 'default' } },
    };
    const button = createChange(source, 'candidate-button', 'change-button', buttonNode, []);
    document = stageCandidates(
      document,
      'run-1',
      [{ id: 'candidate-button', fidelity: 'component', atomicChanges: [button.change] }],
      12,
    );
    const first = acceptCandidateChanges(document, 'candidate-button', ['change-button'], [], 13);

    const secondRun: GenerationRun = {
      ...run(first),
      id: 'run-2',
      sourceRevisionId: first.currentRevisionId,
      target: {
        ...run(first).target,
        observationScope: {
          ...run(first).target.observationScope,
          nodeIds: ['frame', 'button'],
        },
        mutationScope: {
          ...run(first).target.mutationScope,
          existingNodeIds: ['frame', 'button'],
        },
      },
      candidateIds: [],
      createdAt: 14,
    };
    let rerun = stageGenerationRun(first, secondRun, 14);
    const operation: DesignOperation = {
      id: 'staged-restyle-button',
      type: 'style',
      actor: 'agent',
      targetIds: ['button'],
      patch: { radius: 12 },
    };
    const after = applyOperation(first, operation, 15);
    const change: AtomicChange = {
      id: 'change-restyle-button',
      candidateId: 'candidate-button-rerun',
      operation,
      dependencyIds: [],
      trace: {
        observation: 'A Button component is visible.',
        context: 'The selected frame is already a local component.',
        inference: 'The component can be refined in place.',
        proposedChange: 'Refine the button radius.',
        evidenceNodeIds: ['frame', 'button'],
        affectedNodeIds: ['button'],
      },
      before: { nodes: { button: structuredClone(first.nodes.button) } },
      after: { nodes: { button: structuredClone(after.nodes.button) } },
    };
    rerun = stageCandidates(
      rerun,
      'run-2',
      [{ id: 'candidate-button-rerun', fidelity: 'component', atomicChanges: [change] }],
      16,
    );
    const accepted = acceptCandidateChanges(
      rerun,
      'candidate-button-rerun',
      ['change-restyle-button'],
      [],
      20,
    );

    expect(Object.keys(accepted.projectComponents ?? {})).toEqual([
      'project-component-codesign-frame',
    ]);
    expect(accepted.nodes.frame.projectComponent).toEqual(first.nodes.frame.projectComponent);
    expect(accepted.projectComponents?.['project-component-codesign-frame']).toMatchObject({
      createdAt: 13,
      updatedAt: 20,
    });
    expect(
      accepted.projectComponents?.['project-component-codesign-frame'].nodes.button.style.radius,
    ).toBe(12);
  });

  it('does not create a local component for wireframe acceptance', () => {
    const source = baseDocument();
    let document = stageGenerationRun(
      source,
      { ...run(source), requestedFidelity: 'wireframe' },
      10,
    );
    const searchField = createChange(
      source,
      'candidate-wireframe',
      'change-search-field',
      node('search-field', 'rectangle', 'frame'),
      [],
    );
    document = stageCandidates(
      document,
      'run-1',
      [
        {
          id: 'candidate-wireframe',
          fidelity: 'wireframe',
          atomicChanges: [searchField.change],
        },
      ],
      12,
    );

    const accepted = acceptCandidateChanges(
      document,
      'candidate-wireframe',
      ['change-search-field'],
      [],
      13,
    );
    expect(accepted.projectComponents).toEqual({});
    expect(accepted.nodes.frame.projectComponent).toBeUndefined();
  });

  it('promotes a generated component-backed root when the selected source is replaced', () => {
    let source = baseDocument();
    source = applyOperation(source, {
      id: 'create-search-group',
      type: 'create',
      actor: 'user',
      node: {
        ...node('search-group', 'group', 'frame'),
        name: 'Search bar',
        provenance: { actor: 'user', operationId: 'create-search-group' },
      },
    });
    const componentRun: GenerationRun = {
      ...run(source),
      target: {
        focusNodeIds: ['search-group'],
        observationScope: {
          kind: 'selection',
          rootId: 'search-group',
          nodeIds: ['search-group', 'frame'],
        },
        mutationScope: {
          existingNodeIds: ['search-group'],
          insertionParentIds: ['frame'],
          regions: [{ ...source.nodes['search-group'].bounds }],
          allowCreate: true,
        },
      },
      contextNodeIds: ['search-group'],
      contextRootId: 'search-group',
    };
    let document = stageGenerationRun(source, componentRun, 10);
    const deleteOperation: DesignOperation = {
      id: 'staged-delete-search-group',
      type: 'delete',
      actor: 'agent',
      targetIds: ['search-group'],
    };
    const afterDelete = applyOperation(source, deleteOperation, 11);
    const deleteChange: AtomicChange = {
      id: 'change-delete-search-group',
      candidateId: 'candidate-search',
      operation: deleteOperation,
      dependencyIds: [],
      trace: {
        observation: 'A Search bar group is selected.',
        context: 'The group can be replaced within its parent frame.',
        inference: 'A component-backed input is appropriate.',
        proposedChange: 'Replace the primitive group.',
        evidenceNodeIds: ['search-group'],
        affectedNodeIds: ['search-group'],
      },
      before: { nodes: { 'search-group': structuredClone(source.nodes['search-group']) } },
      after: { nodes: { 'search-group': null } },
    };
    const inputNode = {
      ...node('search-input', 'instance', 'frame'),
      name: 'Search bar',
      componentBinding: { componentId: 'Input', props: { placeholder: 'Search' } },
    };
    const input = createChange(
      afterDelete,
      'candidate-search',
      'change-create-search-input',
      inputNode,
      ['change-delete-search-group'],
    );
    document = stageCandidates(
      document,
      'run-1',
      [
        {
          id: 'candidate-search',
          fidelity: 'component',
          atomicChanges: [deleteChange, input.change],
        },
      ],
      12,
    );

    const accepted = acceptCandidateChanges(
      document,
      'candidate-search',
      ['change-create-search-input'],
      [],
      13,
    );
    expect(accepted.nodes['search-group']).toBeUndefined();
    expect(accepted.nodes['search-input'].projectComponent).toEqual({
      componentId: 'project-component-codesign-search-input',
      role: 'main',
    });
    expect(accepted.projectComponents?.['project-component-codesign-search-input']).toMatchObject({
      name: 'Search bar',
      rootId: 'search-input',
      sourceNodeId: 'search-input',
    });
    expect(isDesignDocumentV2(accepted)).toBe(true);
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
