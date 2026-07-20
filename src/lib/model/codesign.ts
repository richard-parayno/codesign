import {
  applyOperationBatch,
  appendProcessEvent,
  canvasSnapshot,
  OperationError,
} from './operations';
import {
  atomicChangeSchema,
  generationRunSchema,
  type AtomicChange,
  type AtomicDecision,
  type CandidateRevision,
  type CanvasSnapshot,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type Fidelity,
  type GenerationRun,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

export class CodesignError extends Error {}

export function recordGenerationOutcome(
  input: DesignDocument,
  type: 'generation-failed' | 'generation-cancelled',
  details: Record<string, string | number | boolean | null | string[]> = {},
  timestamp = Date.now(),
) {
  const document = clone(input);
  appendProcessEvent(document, {
    type,
    actor: type === 'generation-cancelled' ? 'user' : 'system',
    timestamp,
    revisionId: document.currentRevisionId,
    details,
  });
  return document;
}

export type CandidateDraft = {
  id: string;
  fidelity: Fidelity;
  atomicChanges: AtomicChange[];
  createdAt?: number;
};

function assertUnique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new CodesignError(`${label} must be unique`);
}

function snapshotDocument(
  document: DesignDocument,
  revisionId: string,
  snapshot: CanvasSnapshot,
): DesignDocument {
  return {
    ...clone(document),
    ...clone(snapshot),
    currentRevisionId: revisionId,
  };
}

function operationMutationIds(operation: DesignOperation) {
  if ('targetIds' in operation) return operation.targetIds;
  if ('targetId' in operation) return [operation.targetId];
  if (operation.type === 'transition') return [operation.transition.sourceNodeId];
  if (operation.type === 'create') return operation.node.parentId ? [operation.node.parentId] : [];
  return [];
}

function boundsInsideMutationRegion(
  bounds: DesignNode['bounds'],
  regions: GenerationRun['target']['mutationScope']['regions'],
) {
  return regions.some(
    (region) =>
      bounds.x >= region.x &&
      bounds.y >= region.y &&
      bounds.x + bounds.width <= region.x + region.width &&
      bounds.y + bounds.height <= region.y + region.height,
  );
}

function dependencyOrder(changes: AtomicChange[], selectedIds?: string[]) {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const requested = selectedIds ? new Set(selectedIds) : new Set(byId.keys());
  for (const id of requested)
    if (!byId.has(id)) throw new CodesignError('Atomic change does not exist');
  const order: AtomicChange[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new CodesignError('Atomic change dependencies must be acyclic');
    const change = byId.get(id);
    if (!change) throw new CodesignError('Atomic change dependency does not exist');
    visiting.add(id);
    change.dependencyIds.forEach(visit);
    visiting.delete(id);
    visited.add(id);
    order.push(change);
  };
  requested.forEach(visit);
  return order;
}

function same(value: unknown, expected: unknown): boolean {
  if (Object.is(value, expected)) return true;
  if (Array.isArray(value) || Array.isArray(expected))
    return (
      Array.isArray(value) &&
      Array.isArray(expected) &&
      value.length === expected.length &&
      value.every((item, index) => same(item, expected[index]))
    );
  if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object')
    return false;
  const valueRecord = value as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const keys = new Set([...Object.keys(valueRecord), ...Object.keys(expectedRecord)]);
  return [...keys].every((key) => same(valueRecord[key], expectedRecord[key]));
}

function assertStateSlice(
  document: DesignDocument,
  change: AtomicChange,
  side: 'before' | 'after',
) {
  for (const [id, expected] of Object.entries(change[side].nodes)) {
    const actual = document.nodes[id] ?? null;
    if (!same(actual, expected))
      throw new CodesignError(`Atomic change ${change.id} ${side} state does not match node ${id}`);
  }
  for (const [screenId, expected] of Object.entries(change[side].screenRootIds ?? {})) {
    const actual = document.screens.find((screen) => screen.id === screenId)?.rootIds;
    if (!same(actual, expected))
      throw new CodesignError(`Atomic change ${side} state does not match screen ${screenId}`);
  }
}

function assertBoundary(
  document: DesignDocument,
  run: GenerationRun,
  change: AtomicChange,
  additionalMutableIds: ReadonlySet<string> = new Set(),
) {
  const mutable = new Set([...run.target.mutationScope.existingNodeIds, ...additionalMutableIds]);
  const targets = operationMutationIds(change.operation);
  if (change.operation.type === 'create') {
    if (!run.target.mutationScope.allowCreate)
      throw new CodesignError('Atomic creation is disabled for this generation target');
    const parentId = change.operation.node.parentId;
    if (
      parentId &&
      !run.target.mutationScope.insertionParentIds.includes(parentId) &&
      !additionalMutableIds.has(parentId)
    )
      throw new CodesignError('Atomic creation exceeds the insertion scope');
    if (
      !parentId &&
      (run.target.mutationScope.insertionParentIds.length > 0 ||
        run.target.observationScope.kind !== 'screen')
    )
      throw new CodesignError('Atomic root creation exceeds the insertion scope');
    if (!boundsInsideMutationRegion(change.operation.node.bounds, run.target.mutationScope.regions))
      throw new CodesignError('Atomic creation exceeds the editable region');
  } else if (targets.some((id) => !mutable.has(id)))
    throw new CodesignError('Atomic change exceeds the existing-node mutation scope');
  if (
    change.operation.type === 'resize' &&
    !boundsInsideMutationRegion(change.operation.bounds, run.target.mutationScope.regions)
  )
    throw new CodesignError('Atomic resize exceeds the editable region');
  if (change.operation.type === 'move') {
    for (const id of change.operation.targetIds) {
      const node = document.nodes[id];
      if (
        !node ||
        !boundsInsideMutationRegion(
          {
            ...node.bounds,
            x: node.bounds.x + change.operation.dx,
            y: node.bounds.y + change.operation.dy,
          },
          run.target.mutationScope.regions,
        )
      )
        throw new CodesignError('Atomic move exceeds the editable region');
    }
  }
  if (targets.some((id) => run.pinnedNodeIds.includes(id) || document.pinnedNodeIds.includes(id)))
    throw new CodesignError('Atomic change targets a pinned node');
  for (const id of change.trace.evidenceNodeIds)
    if (!run.target.observationScope.nodeIds.includes(id))
      throw new CodesignError('Derivation evidence exceeds the observation scope');
  for (const id of change.trace.affectedNodeIds)
    if (
      !mutable.has(id) &&
      !(change.operation.type === 'create' && id === change.operation.node.id)
    )
      throw new CodesignError('Derivation trace exceeds the mutation scope');
}

function deriveCandidateStatus(
  decisions: Record<string, AtomicDecision>,
): CandidateRevision['status'] {
  const values = Object.values(decisions);
  if (values.length && values.every((decision) => decision === 'accepted')) return 'accepted';
  if (values.length && values.every((decision) => decision === 'rejected')) return 'rejected';
  if (values.some((decision) => decision !== 'pending')) return 'partially-accepted';
  return 'candidate';
}

function materializeOperation(operation: DesignOperation, id: string): DesignOperation {
  const materialized = { ...clone(operation), id, actor: 'agent' } as DesignOperation;
  if (materialized.type === 'create')
    materialized.node.provenance = { actor: 'agent', operationId: id };
  return materialized;
}

export function stageGenerationRun(
  input: DesignDocument,
  candidate: unknown,
  timestamp = Date.now(),
) {
  const parsed = generationRunSchema.safeParse(candidate);
  if (!parsed.success) throw new CodesignError(parsed.error.issues[0]?.message ?? 'Invalid run');
  const run = parsed.data;
  if (input.generationRuns[run.id]) throw new CodesignError('Generation run ID already exists');
  if (run.sourceRevisionId !== input.currentRevisionId)
    throw new CodesignError('Generation source is stale');
  const source = input.revisions[run.sourceRevisionId]?.snapshot;
  if (!source) throw new CodesignError('Generation source revision does not exist');
  assertUnique(run.target.focusNodeIds, 'Focus node IDs');
  assertUnique(run.target.observationScope.nodeIds, 'Observation scope IDs');
  assertUnique(run.target.mutationScope.existingNodeIds, 'Existing mutation IDs');
  assertUnique(run.target.mutationScope.insertionParentIds, 'Insertion parent IDs');
  assertUnique(run.pinnedNodeIds, 'Pinned node IDs');
  if (run.target.observationScope.nodeIds.some((id) => !source.nodes[id]))
    throw new CodesignError('Observation scope contains an unknown node');
  if (run.target.focusNodeIds.some((id) => !source.nodes[id]))
    throw new CodesignError('Focus contains an unknown node');
  if (run.target.mutationScope.existingNodeIds.some((id) => !source.nodes[id]))
    throw new CodesignError('Mutation scope contains an unknown node');
  if (
    run.target.mutationScope.existingNodeIds.some(
      (id) => !run.target.observationScope.nodeIds.includes(id),
    )
  )
    throw new CodesignError('Mutation scope must be observable');
  if (
    run.target.mutationScope.insertionParentIds.some(
      (id) => !source.nodes[id] || !run.target.observationScope.nodeIds.includes(id),
    )
  )
    throw new CodesignError('Insertion parents must be observable');
  if (run.pinnedNodeIds.some((id) => !source.nodes[id]))
    throw new CodesignError('Pinned scope contains an unknown node');
  if (
    run.target.mutationScope.insertionParentIds.some(
      (id) => run.pinnedNodeIds.includes(id) || input.pinnedNodeIds.includes(id),
    )
  )
    throw new CodesignError('Pinned nodes cannot be insertion parents');

  const document = clone(input);
  document.generationRuns[run.id] = clone(run);
  appendProcessEvent(document, {
    type: 'checkpoint-created',
    actor: 'system',
    timestamp,
    revisionId: run.sourceRevisionId,
    generationRunId: run.id,
  });
  appendProcessEvent(document, {
    type: 'generation-requested',
    actor: 'user',
    timestamp,
    revisionId: run.sourceRevisionId,
    generationRunId: run.id,
    details: {
      action: run.action,
      requestedFidelity: run.requestedFidelity,
      provider: run.provider,
      model: run.model ?? 'deterministic-local',
      reasoningEffort: run.reasoningEffort ?? 'none',
      focusNodeIds: run.target.focusNodeIds,
      observationKind: run.target.observationScope.kind,
      observationNodeCount: run.target.observationScope.nodeIds.length,
      mutationNodeCount: run.target.mutationScope.existingNodeIds.length,
      insertionParentIds: run.target.mutationScope.insertionParentIds,
      editableRegionCount: run.target.mutationScope.regions.length,
      contextSnapshotId: run.contextSnapshotId ?? 'none',
      contextRootId: run.contextRootId ?? 'screen',
      contextNodeIds: run.contextNodeIds,
      contextSummarized: run.contextSummarized,
      contextSchemaVersion: run.contextSchemaVersion,
      promptVersion: run.promptVersion,
      schemaVersion: run.schemaVersion,
      snapshotMimeType: run.snapshot?.mimeType ?? 'none',
      snapshotWidth: run.snapshot?.width ?? 0,
      snapshotHeight: run.snapshot?.height ?? 0,
      snapshotSha256: run.snapshot?.sha256 ?? 'none',
      fallback: run.fallback,
    },
  });
  return document;
}

export function stageCandidates(
  input: DesignDocument,
  generationRunId: string,
  drafts: CandidateDraft[],
  timestamp = Date.now(),
) {
  if (!drafts.length) throw new CodesignError('At least one candidate is required');
  const run = input.generationRuns[generationRunId];
  if (!run) throw new CodesignError('Generation run does not exist');
  const sourceRevision = input.revisions[run.sourceRevisionId];
  if (!sourceRevision) throw new CodesignError('Generation source revision does not exist');
  const document = clone(input);
  assertUnique(
    drafts.map((draft) => draft.id),
    'Candidate IDs',
  );

  for (const draft of drafts) {
    if (document.candidates[draft.id]) throw new CodesignError('Candidate ID already exists');
    if (!draft.atomicChanges.length) throw new CodesignError('Candidate needs atomic changes');
    assertUnique(
      draft.atomicChanges.map((change) => change.id),
      'Atomic change IDs',
    );
    const ordered = dependencyOrder(draft.atomicChanges);
    let preview = snapshotDocument(input, run.sourceRevisionId, sourceRevision.snapshot);
    const generatedNodeIds = new Set<string>();
    const generatedBy = new Map<string, string>();
    for (const change of ordered) {
      const parsed = atomicChangeSchema.safeParse(change);
      if (!parsed.success)
        throw new CodesignError(parsed.error.issues[0]?.message ?? 'Invalid atomic change');
      if (change.candidateId !== draft.id)
        throw new CodesignError('Atomic change belongs to another candidate');
      if (document.atomicChanges[change.id])
        throw new CodesignError('Atomic change ID already exists');
      if (change.operation.actor !== 'agent')
        throw new CodesignError('Candidate operations must be agent-authored');
      if (
        change.operation.type === 'create' &&
        change.operation.node.parentId &&
        generatedBy.has(change.operation.node.parentId) &&
        !change.dependencyIds.includes(generatedBy.get(change.operation.node.parentId)!)
      )
        throw new CodesignError('Nested creation must declare its parent dependency');
      assertBoundary(preview, run, change, generatedNodeIds);
      assertStateSlice(preview, change, 'before');
      preview = applyOperationBatch(preview, [change.operation], {
        timestamp,
        transactionId: `candidate-check-${draft.id}-${change.id}`,
        eventType: false,
        revisionStatus: 'candidate',
        origin: 'ai',
      });
      assertStateSlice(preview, change, 'after');
      if (change.operation.type === 'create') {
        generatedNodeIds.add(change.operation.node.id);
        generatedBy.set(change.operation.node.id, change.id);
      }
    }

    const candidatePreview = applyOperationBatch(
      snapshotDocument(input, run.sourceRevisionId, sourceRevision.snapshot),
      ordered.map((change) => change.operation),
      {
        timestamp,
        transactionId: `candidate-${draft.id}`,
        sourceAtomicChangeIds: ordered.map((change) => change.id),
        eventType: false,
        revisionStatus: 'candidate',
        origin: 'ai',
        generationRunId,
        candidateId: draft.id,
      },
    );
    const revision = clone(candidatePreview.revisions[candidatePreview.currentRevisionId]);
    revision.parentRevisionId = run.sourceRevisionId;
    revision.status = 'candidate';
    document.revisions[revision.id] = revision;

    const decisions = Object.fromEntries(ordered.map((change) => [change.id, 'pending' as const]));
    const candidate: CandidateRevision = {
      id: draft.id,
      generationRunId,
      sourceRevisionId: run.sourceRevisionId,
      revisionId: revision.id,
      fidelity: draft.fidelity,
      origin: 'ai',
      atomicChangeIds: ordered.map((change) => change.id),
      decisions,
      status: 'candidate',
      createdAt: draft.createdAt ?? timestamp,
    };
    document.candidates[candidate.id] = candidate;
    ordered.forEach((change) => (document.atomicChanges[change.id] = clone(change)));
    document.generationRuns[generationRunId].candidateIds.push(candidate.id);
  }
  appendProcessEvent(document, {
    type: 'candidates-generated',
    actor: 'agent',
    timestamp,
    revisionId: run.sourceRevisionId,
    generationRunId,
    details: { candidateIds: drafts.map((draft) => draft.id) },
  });
  return document;
}

export function viewCandidate(input: DesignDocument, candidateId: string, timestamp = Date.now()) {
  const candidate = input.candidates[candidateId];
  if (!candidate) throw new CodesignError('Candidate does not exist');
  const document = clone(input);
  appendProcessEvent(document, {
    type: 'candidate-viewed',
    actor: 'user',
    timestamp,
    revisionId: candidate.revisionId,
    generationRunId: candidate.generationRunId,
    candidateId,
  });
  return document;
}

export function rejectCandidate(
  input: DesignDocument,
  candidateId: string,
  timestamp = Date.now(),
) {
  const current = input.candidates[candidateId];
  if (!current) throw new CodesignError('Candidate does not exist');
  if (current.status !== 'candidate')
    throw new CodesignError('Only a pending candidate can be rejected');
  const document = clone(input);
  const candidate = document.candidates[candidateId];
  candidate.status = 'rejected';
  for (const id of candidate.atomicChangeIds) candidate.decisions[id] = 'rejected';
  if (document.revisions[candidate.revisionId])
    document.revisions[candidate.revisionId].status = 'rejected';
  appendProcessEvent(document, {
    type: 'candidate-rejected',
    actor: 'user',
    timestamp,
    revisionId: candidate.revisionId,
    generationRunId: candidate.generationRunId,
    candidateId,
  });
  return document;
}

export function recordReroll(
  input: DesignDocument,
  generationRunId: string,
  timestamp = Date.now(),
) {
  if (!input.generationRuns[generationRunId])
    throw new CodesignError('Generation run does not exist');
  const document = clone(input);
  appendProcessEvent(document, {
    type: 'reroll-requested',
    actor: 'user',
    timestamp,
    revisionId: document.generationRuns[generationRunId].sourceRevisionId,
    generationRunId,
  });
  return document;
}

export function setNodePinned(
  input: DesignDocument,
  nodeId: string,
  pinned: boolean,
  timestamp = Date.now(),
) {
  if (!input.nodes[nodeId]) throw new CodesignError('Pinned node does not exist');
  const document = clone(input);
  const pins = new Set(document.pinnedNodeIds);
  if (pinned) pins.add(nodeId);
  else pins.delete(nodeId);
  document.pinnedNodeIds = [...pins];
  document.revisions[document.currentRevisionId].snapshot.pinnedNodeIds = [...pins];
  appendProcessEvent(document, {
    type: 'pin-changed',
    actor: 'user',
    timestamp,
    revisionId: document.currentRevisionId,
    details: { nodeId, pinned },
  });
  return document;
}

export function setAtomicChangePinned(
  input: DesignDocument,
  atomicChangeId: string,
  pinned: boolean,
  timestamp = Date.now(),
) {
  const change = input.atomicChanges[atomicChangeId];
  if (!change) throw new CodesignError('Atomic change does not exist');
  const document = clone(input);
  appendProcessEvent(document, {
    type: 'pin-changed',
    actor: 'user',
    timestamp,
    revisionId: document.currentRevisionId,
    candidateId: change.candidateId,
    atomicChangeId,
    details: { pinned },
  });
  return document;
}

export function compareWithSource(
  input: DesignDocument,
  candidateId: string,
  timestamp = Date.now(),
) {
  const candidate = input.candidates[candidateId];
  if (!candidate) throw new CodesignError('Candidate does not exist');
  const source = input.revisions[candidate.sourceRevisionId]?.snapshot;
  const proposed = input.revisions[candidate.revisionId]?.snapshot;
  if (!source || !proposed) throw new CodesignError('Candidate comparison revision is missing');
  const document = clone(input);
  appendProcessEvent(document, {
    type: 'source-compared',
    actor: 'user',
    timestamp,
    revisionId: candidate.sourceRevisionId,
    generationRunId: candidate.generationRunId,
    candidateId,
  });
  return { document, source: clone(source), candidate: clone(proposed) };
}

function acceptChanges(
  input: DesignDocument,
  candidateId: string,
  acceptedIds: string[],
  rejectedIds: string[],
  timestamp: number,
  replay: boolean,
) {
  const candidate = input.candidates[candidateId];
  if (!candidate) throw new CodesignError('Candidate does not exist');
  const run = input.generationRuns[candidate.generationRunId];
  if (!run) throw new CodesignError('Generation run does not exist');
  if (!replay && candidate.status !== 'candidate')
    throw new CodesignError('Candidate has already been decided');
  if (!replay && input.currentRevisionId !== candidate.sourceRevisionId)
    throw new CodesignError('Candidate source is stale');
  if (!acceptedIds.length) throw new CodesignError('Select at least one atomic change');
  assertUnique(acceptedIds, 'Accepted change IDs');
  assertUnique(rejectedIds, 'Rejected change IDs');
  if (acceptedIds.some((id) => rejectedIds.includes(id)))
    throw new CodesignError('An atomic change cannot be accepted and rejected');
  const all = candidate.atomicChangeIds.map((id) => input.atomicChanges[id]);
  if (all.some((change) => !change)) throw new CodesignError('Candidate atomic change is missing');
  const ordered = dependencyOrder(all, acceptedIds);
  if (ordered.some((change) => rejectedIds.includes(change.id)))
    throw new CodesignError('A required dependency was rejected');
  if (!replay && ordered.some((change) => candidate.decisions[change.id] === 'rejected'))
    throw new CodesignError('A required dependency was already rejected');

  let base = input;
  if (replay) {
    const source = input.revisions[candidate.sourceRevisionId]?.snapshot;
    if (!source) throw new CodesignError('Replay source revision is missing');
    base = snapshotDocument(input, candidate.sourceRevisionId, source);
  }
  base = clone(base);
  for (const nodeId of run.target.mutationScope.existingNodeIds) {
    const node = base.nodes[nodeId];
    if (!node) continue;
    if (node.kind === 'frame') base.frameFidelity[nodeId] = candidate.fidelity;
    else base.nodeFidelityOverrides[nodeId] = candidate.fidelity;
  }
  const generatedNodeIds = new Set<string>();
  for (const change of ordered) {
    assertBoundary(base, run, change, generatedNodeIds);
    if (change.operation.type === 'create') generatedNodeIds.add(change.operation.node.id);
  }
  const nextRevision = base.revision + 1;
  const transactionId = `${replay ? 'replay' : 'accept'}-${candidateId}-${nextRevision}`;
  const operations = ordered.map((change, index) =>
    materializeOperation(change.operation, `${transactionId}-operation-${index + 1}`),
  );
  let document = applyOperationBatch(base, operations, {
    timestamp,
    transactionId,
    sourceAtomicChangeIds: ordered.map((change) => change.id),
    origin: 'mixed',
    generationRunId: candidate.generationRunId,
    candidateId,
    eventType: false,
  });
  for (const nodeId of run.target.mutationScope.existingNodeIds) {
    const node = document.nodes[nodeId];
    if (!node) continue;
    node.entityId ??= `entity-${node.id}`;
    const entity = document.entities[node.entityId] ?? {
      id: node.entityId,
      parentEntityId: node.parentId ? document.nodes[node.parentId]?.entityId : undefined,
      representationIds: [],
      activeRepresentationId: '',
    };
    document.entities[entity.id] = entity;
    const representationId = `representation-${document.currentRevisionId}-${node.id}`;
    document.representations[representationId] = {
      id: representationId,
      entityId: entity.id,
      fidelity: candidate.fidelity,
      origin: 'mixed',
      revisionId: document.currentRevisionId,
      rootNodeIds: [node.id],
    };
    if (!entity.representationIds.includes(representationId))
      entity.representationIds.push(representationId);
    entity.activeRepresentationId = representationId;
  }
  const acceptedSnapshot = document.revisions[document.currentRevisionId]?.snapshot;
  if (acceptedSnapshot) {
    acceptedSnapshot.entities = clone(document.entities);
    acceptedSnapshot.representations = clone(document.representations);
  }

  const acceptedSet = new Set(ordered.map((change) => change.id));
  for (const id of acceptedSet) document.candidates[candidateId].decisions[id] = 'accepted';
  for (const id of rejectedIds) {
    if (!document.candidates[candidateId].decisions[id])
      throw new CodesignError('Rejected atomic change does not exist');
    document.candidates[candidateId].decisions[id] = 'rejected';
  }
  document.candidates[candidateId].status = deriveCandidateStatus(
    document.candidates[candidateId].decisions,
  );
  for (const id of [...acceptedSet, ...rejectedIds])
    appendProcessEvent(document, {
      type: 'atomic-decision',
      actor: 'user',
      timestamp,
      revisionId: document.currentRevisionId,
      generationRunId: candidate.generationRunId,
      candidateId,
      atomicChangeId: id,
      details: { decision: acceptedSet.has(id) ? 'accepted' : 'rejected' },
    });
  appendProcessEvent(document, {
    type: replay ? 'replayed' : 'candidate-accepted',
    actor: 'user',
    timestamp,
    revisionId: document.currentRevisionId,
    generationRunId: candidate.generationRunId,
    candidateId,
    details: { atomicChangeIds: [...acceptedSet], fidelity: candidate.fidelity },
  });
  return document;
}

export function acceptCandidateChanges(
  input: DesignDocument,
  candidateId: string,
  acceptedIds: string[],
  rejectedIds: string[] = [],
  timestamp = Date.now(),
) {
  return acceptChanges(input, candidateId, acceptedIds, rejectedIds, timestamp, false);
}

export function replayCandidate(
  input: DesignDocument,
  candidateId: string,
  acceptedIds?: string[],
  timestamp = Date.now(),
) {
  const candidate = input.candidates[candidateId];
  if (!candidate) throw new CodesignError('Candidate does not exist');
  return acceptChanges(
    input,
    candidateId,
    acceptedIds ?? candidate.atomicChangeIds,
    [],
    timestamp,
    true,
  );
}

export function activateRevision(
  input: DesignDocument,
  revisionId: string,
  timestamp = Date.now(),
) {
  const revision = input.revisions[revisionId];
  if (!revision) throw new CodesignError('Revision does not exist');
  const document = snapshotDocument(input, revisionId, revision.snapshot);
  appendProcessEvent(document, {
    type: 'revision-activated',
    actor: 'user',
    timestamp,
    revisionId,
    details: { source: 'fidelity-navigation' },
  });
  return document;
}

function contains(outer: DesignNode, inner: DesignNode) {
  return (
    outer.id !== inner.id &&
    outer.bounds.x <= inner.bounds.x &&
    outer.bounds.y <= inner.bounds.y &&
    outer.bounds.x + outer.bounds.width >= inner.bounds.x + inner.bounds.width &&
    outer.bounds.y + outer.bounds.height >= inner.bounds.y + inner.bounds.height
  );
}

export function effectiveFidelity(document: DesignDocument, nodeId: string): Fidelity {
  const node = document.nodes[nodeId];
  if (!node) throw new CodesignError('Node does not exist');
  if (document.nodeFidelityOverrides[nodeId]) return document.nodeFidelityOverrides[nodeId];
  let current: DesignNode | undefined = node;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (document.frameFidelity[current.id]) return document.frameFidelity[current.id];
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  const containingFrames = Object.values(document.nodes)
    .filter((candidate) => candidate.kind === 'frame' && contains(candidate, node))
    .sort(
      (a, b) =>
        a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height ||
        a.id.localeCompare(b.id),
    );
  for (const frame of containingFrames)
    if (document.frameFidelity[frame.id]) return document.frameFidelity[frame.id];
  return node.componentBinding ? 'component' : 'wireframe';
}

export function setFrameFidelity(input: DesignDocument, frameId: string, fidelity: Fidelity) {
  if (input.nodes[frameId]?.kind !== 'frame') throw new OperationError('Frame does not exist');
  const document = clone(input);
  document.frameFidelity[frameId] = fidelity;
  document.revisions[document.currentRevisionId].snapshot.frameFidelity[frameId] = fidelity;
  return document;
}

export function setNodeFidelityOverride(
  input: DesignDocument,
  nodeId: string,
  fidelity?: Fidelity,
) {
  if (!input.nodes[nodeId]) throw new OperationError('Node does not exist');
  const document = clone(input);
  if (fidelity) document.nodeFidelityOverrides[nodeId] = fidelity;
  else delete document.nodeFidelityOverrides[nodeId];
  document.revisions[document.currentRevisionId].snapshot.nodeFidelityOverrides = clone(
    document.nodeFidelityOverrides,
  );
  return document;
}
