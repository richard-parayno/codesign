import { describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { stageCandidates, stageGenerationRun } from '$lib/model/codesign';
import { blankDocument, defaultStyle, type DesignDocument } from '$lib/model/types';
import {
  CANDIDATE_SCHEMA_VERSION,
  CandidateValidationError,
  candidateBatchOutputSchema,
  candidateToDocumentCoordinates,
  createGenerationRun,
  generationRequestSchema,
  normalizeCandidateBatch,
  operationToSceneCoordinates,
  type GenerationRequest,
} from './candidate';
import { candidateBatchFixture } from './fixtures/candidate-batch-fixture';

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
    runId: id,
    createdAt: 123,
  });
}

function expectStrictObjectRequirements(value: unknown, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectStrictObjectRequirements(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const schema = value as Record<string, unknown>;
  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const propertyNames = Object.keys(schema.properties as Record<string, unknown>).sort();
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string').sort()
      : [];
    expect(required, `${path} must require every declared property`).toEqual(propertyNames);
    expect(schema.additionalProperties, `${path} must reject undeclared properties`).toBe(false);
  }

  for (const [key, child] of Object.entries(schema))
    expectStrictObjectRequirements(child, `${path}.${key}`);
}

describe('Codesign candidate backend contract', () => {
  it('uses an OpenAI-compatible strict schema for every nested object', () => {
    expectStrictObjectRequirements(candidateBatchOutputSchema);
  });

  it('uses nullable update fields in the wire response and removes null sentinels', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const wire = candidateBatchFixture(request, run);
    const change = wire.candidate.atomicChanges[0];
    change.operation = {
      id: change.operation.id,
      type: 'update-node',
      actor: 'agent',
      targetIds: ['region'],
      patch: { name: 'Updated region', text: null },
    };
    change.trace.affectedNodeIds = ['region'];

    const candidate = normalizeCandidateBatch(request, run, wire);
    expect(candidate.atomicChanges[0].operation).toMatchObject({
      type: 'update-node',
      patch: { name: 'Updated region' },
    });
    expect(candidate.atomicChanges[0].operation).not.toHaveProperty('patch.text');
  });

  it('restores relative create and resize bounds to document coordinates without mutating input', () => {
    const request = requestFor(sourceDocument());
    const run = runFor(request);
    const wire = candidateBatchFixture(request, run);
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

  it('normalizes a predefined structured response fixture and stages it in the model', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const wire = candidateBatchFixture(request, run);
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
      componentBinding: { componentId: 'Button', props: { variant: 'secondary' } },
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

  it('accepts a model response that preserves a pinned change exactly once', () => {
    const document = sourceDocument();
    const firstRequest = requestFor(document);
    const firstRun = runFor(firstRequest, 'generation-style-first');
    const first = normalizeCandidateBatch(
      firstRequest,
      firstRun,
      candidateBatchFixture(firstRequest, firstRun),
    );
    const pinned = first.atomicChanges.find((change) => change.operation.type === 'style')!;
    const rerollRequest = { ...requestFor(document), pinnedAtomicChanges: [pinned] };
    const rerollRun = runFor(rerollRequest, 'generation-style-reroll');
    const wire = candidateBatchFixture(rerollRequest, rerollRun);
    wire.candidate.atomicChanges[0].preservedFromAtomicChangeId = pinned.id;
    wire.candidate.atomicChanges[0].trace = {
      ...pinned.trace,
      affectedNodeIds: [...pinned.trace.affectedNodeIds],
    };
    const rerolled = normalizeCandidateBatch(rerollRequest, rerollRun, wire);

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
    const wire = candidateBatchFixture(request, run);

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
    const omitted = candidateBatchFixture({ ...pinnedRequest, pinnedAtomicChanges: [] }, pinnedRun);
    expect(() => normalizeCandidateBatch(pinnedRequest, pinnedRun, omitted)).toThrow(
      'omitted a pinned atomic change',
    );
  });

  it('requires later mutations of generated nodes to depend on their creation', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const wire = candidateBatchFixture(request, run);
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

  it('accepts bounded model preferences and rejects command-like model values', () => {
    const request = requestFor(sourceDocument());
    expect(
      generationRequestSchema.parse({
        ...request,
        providerOptions: { model: 'gpt-5.6-luna', effort: 'high' },
      }).providerOptions,
    ).toEqual({ model: 'gpt-5.6-luna', effort: 'high' });
    expect(() =>
      generationRequestSchema.parse({
        ...request,
        providerOptions: { model: '../../command --flag' },
      }),
    ).toThrow();
  });

  it('rejects malformed component bindings and unregistered style values', () => {
    const document = sourceDocument();
    const request = requestFor(document);
    const run = runFor(request);
    const badBinding = structuredClone(candidateBatchFixture(request, run));
    const create = badBinding.candidate.atomicChanges[3].operation;
    if (create.type === 'create' && create.node.componentBinding)
      create.node.componentBinding.componentId = 'Card';
    expect(() => normalizeCandidateBatch(request, run, badBinding)).toThrow(
      'Card does not allow prop variant',
    );

    const badStyle = structuredClone(candidateBatchFixture(request, run));
    const style = badStyle.candidate.atomicChanges[0].operation;
    if (style.type === 'style') style.patch.fill = '#ff00ff';
    expect(() => normalizeCandidateBatch(request, run, badStyle)).toThrow('unregistered fill');
  });

  it('accepts dependency-ordered nested component parts and rejects missing parent dependencies', () => {
    const request = requestFor(sourceDocument());
    const run = runFor(request);
    const wire = structuredClone(candidateBatchFixture(request, run));
    const rootChange = wire.candidate.atomicChanges[1];
    const partChange = wire.candidate.atomicChanges[2];
    if (rootChange.operation.type !== 'create' || partChange.operation.type !== 'create')
      throw new Error('Fixture must contain create operations');
    rootChange.operation.node.kind = 'instance';
    rootChange.operation.node.text = null;
    rootChange.operation.node.componentBinding = {
      componentId: 'Card',
      props: { density: 'comfortable', radius: 'medium' },
      slot: null,
    };
    partChange.operation.node.kind = 'instance';
    partChange.operation.node.parentId = rootChange.operation.node.id;
    partChange.operation.node.text = null;
    partChange.operation.node.componentBinding = {
      componentId: 'Card.Header',
      props: {},
      slot: 'default',
    };
    partChange.dependencyIds = [rootChange.id];
    wire.candidate.atomicChanges = [wire.candidate.atomicChanges[0], rootChange, partChange];

    const normalized = normalizeCandidateBatch(request, run, wire);
    const createdPart = normalized.atomicChanges[2].operation;
    expect(createdPart).toMatchObject({
      type: 'create',
      node: {
        parentId: rootChange.operation.node.id,
        componentBinding: { componentId: 'Card.Header', slot: 'default' },
      },
    });

    partChange.dependencyIds = [];
    expect(() => normalizeCandidateBatch(request, run, wire)).toThrow(
      'depend on its parent creation',
    );
  });

  it('returns a typed validation error for unsupported actions', () => {
    const request = { ...requestFor(sourceDocument()), action: 'vary' as const };
    const run = runFor(request);
    expect(() => normalizeCandidateBatch(request, run, {})).toThrow(CandidateValidationError);
    expect(() => normalizeCandidateBatch(request, run, {})).toThrow('not available');
  });
});
