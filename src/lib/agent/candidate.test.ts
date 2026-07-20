import { describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { stageCandidates, stageGenerationRun } from '$lib/model/codesign';
import { blankDocument, defaultStyle, type DesignDocument } from '$lib/model/types';
import {
  CANDIDATE_SCHEMA_VERSION,
  CandidateValidationError,
  candidateToDocumentCoordinates,
  createGenerationRun,
  generationRequestSchema,
  normalizeCandidateBatch,
  operationToSceneCoordinates,
  type GenerationRequest,
} from './candidate';
import { localCandidateBatch } from './local';

function sourceDocument() {
  return applyOperation(blankDocument(), {
    id: 'create-region',
    type: 'create',
    actor: 'user',
    node: {
      id: 'region',
      name: 'Rough content region',
      kind: 'rectangle',
      screenId: 'screen-1',
      childIds: [],
      bounds: { x: 40, y: 40, width: 360, height: 280 },
      style: { ...defaultStyle },
      provenance: { actor: 'user', operationId: 'create-region' },
    },
  });
}

function requestFor(document: DesignDocument): GenerationRequest {
  return {
    projectId: 'test-project',
    action: 'complete',
    requestedFidelity: 'component',
    target: {
      focusNodeIds: ['region'],
      observationScope: { kind: 'screen', nodeIds: ['region'] },
      mutationScope: {
        existingNodeIds: ['region'],
        insertionParentIds: [],
        regions: [{ ...document.nodes.region.bounds }],
        allowCreate: true,
      },
    },
    pinnedNodeIds: [],
    pinnedAtomicChanges: [],
    visualSnapshot: {
      id: 'snapshot-1',
      mimeType: 'image/png',
      width: 720,
      height: 560,
      data: 'a'.repeat(16),
    },
    document: {
      currentRevisionId: document.currentRevisionId,
      activeScreenId: document.activeScreenId,
      screenName: document.screens[0].name,
      screenRootIds: [...document.screens[0].rootIds],
      knownNodeIds: Object.keys(document.nodes),
      nodes: structuredClone(document.nodes),
      frameFidelity: structuredClone(document.frameFidelity),
      nodeFidelityOverrides: structuredClone(document.nodeFidelityOverrides),
    },
  };
}

function runFor(request: GenerationRequest, id = 'generation-test') {
  return createGenerationRun(request, {
    backend: 'local',
    runId: id,
    createdAt: 123,
  });
}

describe('Codesign candidate backend contract', () => {
  it('restores relative create and resize bounds to document coordinates without mutating input', () => {
    const request = requestFor(sourceDocument());
    const run = runFor(request);
    const wire = localCandidateBatch(request, run);
    const create = wire.candidate.atomicChanges.find(
      (change) => change.operation.type === 'create',
    )!.operation;
    if (create.type !== 'create') throw new Error('Expected create operation');
    const before = { ...create.node.bounds };

    const restored = candidateToDocumentCoordinates(wire, { x: 100, y: 50 });
    const restoredCreate = restored.candidate.atomicChanges.find(
      (change) => change.operation.type === 'create',
    )!.operation;
    if (restoredCreate.type !== 'create') throw new Error('Expected create operation');
    expect(restoredCreate.node.bounds).toMatchObject({ x: before.x + 100, y: before.y + 50 });
    expect(create.node.bounds).toEqual(before);

    const persisted = normalizeCandidateBatch(request, run, wire).atomicChanges.find(
      (change) => change.operation.type === 'create',
    )!.operation;
    if (persisted.type !== 'create') throw new Error('Expected persisted create operation');
    const persistedBefore = structuredClone(persisted.node.bounds);
    const relative = operationToSceneCoordinates(persisted, { x: 100, y: 50 });
    expect(relative.type === 'create' ? relative.node.bounds : null).toMatchObject({
      x: persistedBefore.x - 100,
      y: persistedBefore.y - 50,
    });
    expect(persisted.node.bounds).toEqual(persistedBefore);
  });

  it('produces a structured four-change local completion that stages in the model', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const wire = localCandidateBatch(request, run);
    const candidate = normalizeCandidateBatch(request, run, wire);

    expect(wire.schemaVersion).toBe(CANDIDATE_SCHEMA_VERSION);
    expect(candidate.atomicChanges).toHaveLength(4);
    expect(candidate.atomicChanges.map((change) => change.operation.type)).toEqual([
      'style',
      'create',
      'create',
      'create',
    ]);
    expect(candidate.atomicChanges.every((change) => change.trace.observation.length > 0)).toBe(
      true,
    );
    expect(candidate.atomicChanges[1].dependencyIds).toEqual([candidate.atomicChanges[0].id]);
    expect(candidate.atomicChanges[1].before.nodes['generation-test-node-heading']).toBeNull();
    expect(candidate.atomicChanges[1].after.nodes['generation-test-node-heading']).toMatchObject({
      kind: 'text',
    });
    expect(
      candidate.atomicChanges[1].after.nodes['generation-test-node-heading']?.parentId,
    ).toBeUndefined();
    expect(candidate.atomicChanges[3].after.nodes['generation-test-node-action']).toMatchObject({
      kind: 'instance',
      componentBinding: { componentId: 'Button', props: { variant: 'primary', size: 'small' } },
    });

    const stagedRun = stageGenerationRun(document, run, 123);
    const staged = stageCandidates(stagedRun, run.id, [candidate], 123);
    expect(staged.candidates[candidate.id]).toMatchObject({
      sourceRevisionId: document.currentRevisionId,
      fidelity: 'component',
      status: 'candidate',
    });
    expect(
      staged.revisions[staged.candidates[candidate.id].revisionId].snapshot.nodes,
    ).toHaveProperty('generation-test-node-action');
  });

  it('preserves a pinned generated atomic change across a reroll with fresh stable IDs', () => {
    const document = sourceDocument();
    const firstRequest = requestFor(document);
    const firstRun = runFor(firstRequest, 'generation-first');
    const first = normalizeCandidateBatch(
      firstRequest,
      firstRun,
      localCandidateBatch(firstRequest, firstRun),
    );
    const pinned = first.atomicChanges.find((change) => change.operation.type === 'create')!;
    if (pinned.operation.type !== 'create') throw new Error('Expected a generated create change');
    const pinnedNodeName = pinned.operation.node.name;
    const dependency = first.atomicChanges.find((change) =>
      pinned.dependencyIds.includes(change.id),
    );
    const rerollRequest = {
      ...requestFor(document),
      pinnedAtomicChanges: dependency ? [dependency, pinned] : [pinned],
    };
    const rerollRun = runFor(rerollRequest, 'generation-reroll');
    const rerolled = normalizeCandidateBatch(
      rerollRequest,
      rerollRun,
      localCandidateBatch(rerollRequest, rerollRun),
    );

    const preserved = rerolled.atomicChanges.find(
      (change) => change.preservedFromAtomicChangeId === pinned.id,
    )!;
    expect(preserved.id).toBe('generation-reroll-pinned-change-2');
    expect(preserved.preservedFromAtomicChangeId).toBe(pinned.id);
    expect(preserved.operation.id).toBe('generation-reroll-pinned-operation-2');
    expect(preserved.operation).toMatchObject({
      type: 'create',
      node: {
        id: 'generation-reroll-pinned-node-1',
        name: 'Candidate heading',
        text: 'Continue from here',
      },
    });
    expect(preserved.trace.observation).toBe(pinned.trace.observation);
    expect(
      rerolled.atomicChanges.filter(
        (change) =>
          change.operation.type === 'create' && change.operation.node.name === pinnedNodeName,
      ),
    ).toHaveLength(1);
  });

  it('does not duplicate a pinned container style when rerolling the remaining changes', () => {
    const document = sourceDocument();
    const firstRequest = requestFor(document);
    const firstRun = runFor(firstRequest, 'generation-style-first');
    const first = normalizeCandidateBatch(
      firstRequest,
      firstRun,
      localCandidateBatch(firstRequest, firstRun),
    );
    const pinned = first.atomicChanges.find((change) => change.operation.type === 'style')!;
    const rerollRequest = { ...requestFor(document), pinnedAtomicChanges: [pinned] };
    const rerollRun = runFor(rerollRequest, 'generation-style-reroll');
    const rerolled = normalizeCandidateBatch(
      rerollRequest,
      rerollRun,
      localCandidateBatch(rerollRequest, rerollRun),
    );

    expect(
      rerolled.atomicChanges.filter(
        (change) =>
          change.operation.type === 'style' && change.operation.targetIds.includes('region'),
      ),
    ).toHaveLength(1);
    expect(rerolled.atomicChanges[0].preservedFromAtomicChangeId).toBe(pinned.id);
  });

  it('rejects stale, out-of-scope, cyclic, and omitted-pinned candidate batches', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const wire = localCandidateBatch(request, run);

    expect(() =>
      normalizeCandidateBatch(request, { ...run, sourceRevisionId: 'revision-stale' }, wire),
    ).toThrow('stale');

    const outOfScope = structuredClone(wire);
    const style = outOfScope.candidate.atomicChanges[0].operation;
    if (style.type === 'style') style.targetIds = ['not-in-scope'];
    expect(() => normalizeCandidateBatch(request, run, outOfScope)).toThrow('mutation scope');

    const cyclic = structuredClone(wire);
    cyclic.candidate.atomicChanges[0].dependencyIds = [cyclic.candidate.atomicChanges[1].id];
    expect(() => normalizeCandidateBatch(request, run, cyclic)).toThrow('acyclic');

    const candidate = normalizeCandidateBatch(request, run, wire);
    const pinnedRequest = {
      ...request,
      pinnedAtomicChanges: [candidate.atomicChanges[0]],
    };
    const pinnedRun = runFor(pinnedRequest, 'generation-pinned');
    const omitted = localCandidateBatch({ ...pinnedRequest, pinnedAtomicChanges: [] }, pinnedRun);
    expect(() => normalizeCandidateBatch(pinnedRequest, pinnedRun, omitted)).toThrow(
      'omitted a pinned atomic change',
    );
  });

  it('requires later mutations of generated nodes to depend on their creation', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const wire = localCandidateBatch(request, run);
    const heading = wire.candidate.atomicChanges[1];
    const later = wire.candidate.atomicChanges[2];
    if (heading.operation.type !== 'create') throw new Error('Expected generated heading');
    later.operation = {
      id: later.operation.id,
      type: 'style',
      actor: 'agent',
      targetIds: [heading.operation.node.id],
      patch: {
        fill: '#ffffff',
        stroke: null,
        strokeWidth: null,
        opacity: null,
        radius: null,
        padding: null,
        textColor: null,
        fontSize: null,
        fontWeight: null,
        textAlign: null,
        lineHeight: null,
        density: null,
      },
    };
    later.trace.affectedNodeIds = [heading.operation.node.id];

    expect(() => normalizeCandidateBatch(request, run, wire)).toThrow(
      'depend on its creation change',
    );
  });

  it('does not accept browser-provided image transport fields', () => {
    const request = requestFor(sourceDocument());
    const parsed = generationRequestSchema.parse({
      ...request,
      visualInput: { type: 'localImage', path: '/home/user/private.png' },
    }) as GenerationRequest & { visualInput?: unknown };
    expect(parsed.visualInput).toBeUndefined();
  });

  it('rejects malformed component bindings and unregistered style values', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const badBinding = structuredClone(localCandidateBatch(request, run));
    const create = badBinding.candidate.atomicChanges[3].operation;
    if (create.type === 'create' && create.node.componentBinding)
      create.node.componentBinding.componentId = 'Card';
    expect(() => normalizeCandidateBatch(request, run, badBinding)).toThrow(
      'Card does not allow prop variant',
    );

    const badStyle = structuredClone(localCandidateBatch(request, run));
    const style = badStyle.candidate.atomicChanges[0].operation;
    if (style.type === 'style') style.patch.fill = '#ff00ff';
    expect(() => normalizeCandidateBatch(request, run, badStyle)).toThrow('unregistered fill');
  });

  it('returns a typed validation error for unsupported actions', () => {
    const request = { ...requestFor(sourceDocument()), action: 'vary' as const };
    const run = runFor(request);
    expect(() => normalizeCandidateBatch(request, run, {})).toThrow(CandidateValidationError);
    expect(() => normalizeCandidateBatch(request, run, {})).toThrow('not available');
  });
});
