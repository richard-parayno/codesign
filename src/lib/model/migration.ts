import {
  atomicChangeSchema,
  candidateRevisionSchema,
  generationRunSchema,
  nodeSchema,
  operationSchema,
  processEventSchema,
  type CanvasSnapshot,
  type DesignDocument,
  type DesignEntity,
  type DesignNode,
  type DesignRevision,
  type LegacyDesignDocumentV1,
  type OperationRecord,
  type Origin,
  type Representation,
} from './types';

export type ProjectSummary = { id: string; name: string };
export type LegacyProjectEnvelopeV1 = {
  version: 1;
  activeProjectId: string;
  projects: Array<ProjectSummary & { document: LegacyDesignDocumentV1 }>;
};
export type ProjectEnvelopeV2 = {
  version: 2;
  activeProjectId: string;
  projects: Array<ProjectSummary & { document: DesignDocument }>;
};

const clone = <T>(value: T): T => structuredClone(value);

function validScreensAndBranches(value: {
  screens?: unknown;
  branches?: unknown;
  activeScreenId?: unknown;
  activeBranchId?: unknown;
}) {
  if (!Array.isArray(value.screens) || !value.screens.length) return false;
  if (!Array.isArray(value.branches) || !value.branches.length) return false;
  const screens = value.screens as Array<Record<string, unknown>>;
  const branches = value.branches as Array<Record<string, unknown>>;
  if (
    screens.some(
      (screen) =>
        typeof screen.id !== 'string' ||
        !screen.id ||
        typeof screen.name !== 'string' ||
        typeof screen.branchId !== 'string' ||
        !Array.isArray(screen.rootIds) ||
        screen.rootIds.some((id) => typeof id !== 'string'),
    ) ||
    branches.some(
      (branch) =>
        typeof branch.id !== 'string' ||
        !branch.id ||
        typeof branch.name !== 'string' ||
        !Array.isArray(branch.screenIds) ||
        branch.screenIds.some((id) => typeof id !== 'string'),
    )
  )
    return false;
  const screenIds = new Set(screens.map((screen) => screen.id));
  const branchIds = new Set(branches.map((branch) => branch.id));
  if (!screenIds.has(value.activeScreenId) || !branchIds.has(value.activeBranchId)) return false;
  return screens.every(
    (screen) =>
      branchIds.has(screen.branchId) &&
      branches.some(
        (branch) =>
          branch.id === screen.branchId && (branch.screenIds as unknown[]).includes(screen.id),
      ),
  );
}

function validCanvas(value: Partial<CanvasSnapshot>) {
  if (
    !validScreensAndBranches(value) ||
    !value.nodes ||
    typeof value.nodes !== 'object' ||
    !Array.isArray(value.transitions) ||
    !value.entities ||
    typeof value.entities !== 'object' ||
    !value.representations ||
    typeof value.representations !== 'object' ||
    !Array.isArray(value.pinnedNodeIds) ||
    !value.frameFidelity ||
    typeof value.frameFidelity !== 'object' ||
    !value.nodeFidelityOverrides ||
    typeof value.nodeFidelityOverrides !== 'object'
  )
    return false;
  const screenIds = new Set(value.screens!.map((screen) => screen.id));
  const nodeEntries = Object.entries(value.nodes);
  const fidelities = new Set(['structure', 'wireframe', 'component', 'visual', 'production']);
  if (
    nodeEntries.some(
      ([id, node]) =>
        !nodeSchema.safeParse(node).success ||
        node.id !== id ||
        !screenIds.has(node.screenId) ||
        !node.entityId ||
        !value.entities![node.entityId],
    )
  )
    return false;
  if (
    value.screens!.some((screen) => screen.rootIds.some((id) => !value.nodes![id])) ||
    nodeEntries.some(
      ([, node]) =>
        (node.parentId && !value.nodes![node.parentId]) ||
        node.childIds.some((id) => !value.nodes![id]),
    ) ||
    value.transitions.some(
      (transition) =>
        !value.nodes![transition.sourceNodeId] || !screenIds.has(transition.targetScreenId),
    ) ||
    value.pinnedNodeIds.some((id) => !value.nodes![id]) ||
    Object.entries(value.frameFidelity).some(
      ([id, fidelity]) => value.nodes![id]?.kind !== 'frame' || !fidelities.has(fidelity),
    ) ||
    Object.entries(value.nodeFidelityOverrides).some(
      ([id, fidelity]) => !value.nodes![id] || !fidelities.has(fidelity),
    )
  )
    return false;
  for (const [id, entity] of Object.entries(value.entities)) {
    if (
      entity.id !== id ||
      !entity.activeRepresentationId ||
      !entity.representationIds.includes(entity.activeRepresentationId) ||
      entity.representationIds.some(
        (representationId) => !value.representations![representationId],
      ) ||
      (entity.parentEntityId && !value.entities[entity.parentEntityId])
    )
      return false;
  }
  return Object.entries(value.representations).every(
    ([id, representation]) =>
      representation.id === id &&
      !!value.entities![representation.entityId] &&
      fidelities.has(representation.fidelity) &&
      ['human', 'ai', 'mixed'].includes(representation.origin) &&
      !!representation.revisionId &&
      representation.rootNodeIds.length > 0 &&
      representation.rootNodeIds.every(
        (nodeId) => value.nodes![nodeId]?.entityId === representation.entityId,
      ),
  );
}

export function isLegacyDesignDocumentV1(value: unknown): value is LegacyDesignDocumentV1 {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<LegacyDesignDocumentV1>;
  if (
    document.version !== 1 ||
    !Number.isInteger(document.revision) ||
    document.revision! < 0 ||
    !validScreensAndBranches(document) ||
    !document.nodes ||
    typeof document.nodes !== 'object' ||
    !Array.isArray(document.transitions) ||
    !Array.isArray(document.hypotheses) ||
    !Array.isArray(document.operations)
  )
    return false;
  const screenIds = new Set(document.screens!.map((screen) => screen.id));
  const nodes = Object.entries(document.nodes);
  if (
    nodes.some(
      ([id, node]) =>
        !nodeSchema.safeParse(node).success || node.id !== id || !screenIds.has(node.screenId),
    ) ||
    document.screens!.some((screen) => screen.rootIds.some((id) => !document.nodes![id])) ||
    nodes.some(
      ([, node]) =>
        (node.parentId && !document.nodes![node.parentId]) ||
        node.childIds.some((id) => !document.nodes![id]),
    ) ||
    document.transitions.some(
      (transition) =>
        !document.nodes![transition.sourceNodeId] || !screenIds.has(transition.targetScreenId),
    )
  )
    return false;
  return document.operations.every(
    (record) =>
      !!record &&
      Number.isFinite(record.timestamp) &&
      typeof record.summary === 'string' &&
      operationSchema.safeParse(record).success,
  );
}

export function isLegacyProjectEnvelopeV1(value: unknown): value is LegacyProjectEnvelopeV1 {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<LegacyProjectEnvelopeV1>;
  if (envelope.version !== 1 || !Array.isArray(envelope.projects) || !envelope.projects.length)
    return false;
  const ids = new Set<string>();
  for (const project of envelope.projects) {
    if (
      !project ||
      typeof project.id !== 'string' ||
      !project.id ||
      typeof project.name !== 'string' ||
      !project.name.trim() ||
      !isLegacyDesignDocumentV1(project.document) ||
      ids.has(project.id)
    )
      return false;
    ids.add(project.id);
  }
  return typeof envelope.activeProjectId === 'string' && ids.has(envelope.activeProjectId);
}

function originFor(document: LegacyDesignDocumentV1): Origin {
  const actors = new Set(document.operations.map((operation) => operation.actor));
  if (actors.size > 1) return 'mixed';
  return actors.has('agent') ? 'ai' : 'human';
}

export function migrateDocumentV1(
  source: LegacyDesignDocumentV1,
  sourceKey: string,
  migratedAt = Date.now(),
): DesignDocument {
  if (!isLegacyDesignDocumentV1(source)) throw new Error('Legacy document is invalid');
  const revisionId = `revision-v1-${source.revision}`;
  const nodes: Record<string, DesignNode> = {};
  const entities: Record<string, DesignEntity> = {};
  const representations: Record<string, Representation> = {};
  const pinnedNodeIds: string[] = [];
  const frameFidelity: Record<string, 'wireframe'> = {};
  const nodeFidelityOverrides: Record<string, 'component'> = {};

  for (const legacyNode of Object.values(source.nodes)) {
    const node = clone(legacyNode);
    const legacySemantics = node.semantics;
    delete node.semantics;
    node.entityId = `entity-v1-${node.id}`;
    nodes[node.id] = node;
    if (legacySemantics?.protected) pinnedNodeIds.push(node.id);
    if (node.kind === 'frame') frameFidelity[node.id] = 'wireframe';
    if (node.componentBinding) nodeFidelityOverrides[node.id] = 'component';
  }
  for (const node of Object.values(nodes)) {
    const entityId = node.entityId!;
    const representationId = `representation-v1-${node.id}`;
    entities[entityId] = {
      id: entityId,
      parentEntityId: node.parentId ? nodes[node.parentId]?.entityId : undefined,
      representationIds: [representationId],
      activeRepresentationId: representationId,
    };
    representations[representationId] = {
      id: representationId,
      entityId,
      fidelity: node.componentBinding ? 'component' : 'wireframe',
      origin: node.provenance.actor === 'agent' ? 'ai' : 'human',
      revisionId,
      rootNodeIds: [node.id],
    };
  }

  const canvas: CanvasSnapshot = {
    screens: clone(source.screens),
    nodes,
    transitions: clone(source.transitions),
    branches: clone(source.branches),
    activeBranchId: source.activeBranchId,
    activeScreenId: source.activeScreenId,
    entities,
    representations,
    pinnedNodeIds,
    frameFidelity,
    nodeFidelityOverrides,
  };
  const createdAt = source.operations.at(-1)?.timestamp ?? 0;
  const revision: DesignRevision = {
    id: revisionId,
    status: 'working',
    origin: originFor(source),
    createdAt,
    operationIds: source.operations.map((operation) => operation.id),
    atomicChangeIds: [],
    snapshot: clone(canvas),
  };
  return {
    version: 2,
    revision: source.revision,
    currentRevisionId: revisionId,
    ...canvas,
    revisions: { [revisionId]: revision },
    generationRuns: {},
    candidates: {},
    atomicChanges: {},
    processEvents: [
      {
        id: 'event-0-legacy-imported',
        sequence: 0,
        type: 'legacy-imported',
        actor: 'system',
        timestamp: migratedAt,
        revisionId,
        details: {
          hypothesisCount: source.hypotheses.length,
          semanticNodeCount: Object.values(source.nodes).filter((node) => !!node.semantics).length,
        },
      },
    ],
    operations: clone(source.operations),
    legacyArchive: {
      sourceVersion: 1,
      sourceKey,
      migratedAt,
      document: clone(source),
    },
  };
}

export function migrateProjectEnvelopeV1(
  source: LegacyProjectEnvelopeV1,
  sourceKey: string,
  migratedAt = Date.now(),
): ProjectEnvelopeV2 {
  if (!isLegacyProjectEnvelopeV1(source)) throw new Error('Legacy project envelope is invalid');
  const migrated: ProjectEnvelopeV2 = {
    version: 2,
    activeProjectId: source.activeProjectId,
    projects: source.projects.map((project) => ({
      id: project.id,
      name: project.name,
      document: migrateDocumentV1(project.document, sourceKey, migratedAt),
    })),
  };
  if (!isProjectEnvelopeV2(migrated)) throw new Error('Migrated project envelope is invalid');
  return migrated;
}

function validRevisionGraph(revisions: Record<string, DesignRevision>) {
  for (const [id, revision] of Object.entries(revisions)) {
    if (revision.id !== id || !validCanvas(revision.snapshot)) return false;
    const visited = new Set<string>([id]);
    let parentId = revision.parentRevisionId;
    while (parentId) {
      if (visited.has(parentId) || !revisions[parentId]) return false;
      visited.add(parentId);
      parentId = revisions[parentId].parentRevisionId;
    }
  }
  return true;
}

export function isDesignDocumentV2(value: unknown): value is DesignDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<DesignDocument>;
  if (
    document.version !== 2 ||
    !Number.isInteger(document.revision) ||
    document.revision! < 0 ||
    typeof document.currentRevisionId !== 'string' ||
    !validCanvas(document) ||
    !document.revisions ||
    typeof document.revisions !== 'object' ||
    !document.revisions[document.currentRevisionId] ||
    !document.generationRuns ||
    typeof document.generationRuns !== 'object' ||
    !document.candidates ||
    typeof document.candidates !== 'object' ||
    !document.atomicChanges ||
    typeof document.atomicChanges !== 'object' ||
    !Array.isArray(document.processEvents) ||
    !Array.isArray(document.operations)
  )
    return false;
  if (!validRevisionGraph(document.revisions)) return false;
  const candidates = document.candidates;
  const atomicChanges = document.atomicChanges;
  if (
    Object.entries(document.generationRuns).some(
      ([id, run]) => id !== run.id || !generationRunSchema.safeParse(run).success,
    ) ||
    Object.entries(document.candidates).some(
      ([id, candidate]) =>
        id !== candidate.id || !candidateRevisionSchema.safeParse(candidate).success,
    ) ||
    Object.entries(document.atomicChanges).some(
      ([id, change]) => id !== change.id || !atomicChangeSchema.safeParse(change).success,
    ) ||
    document.processEvents.some(
      (event, index) => !processEventSchema.safeParse(event).success || event.sequence !== index,
    ) ||
    document.operations.some(
      (record) =>
        !Number.isFinite(record.timestamp) ||
        typeof record.summary !== 'string' ||
        !operationSchema.safeParse(record).success,
    )
  )
    return false;
  for (const run of Object.values(document.generationRuns)) {
    if (
      !document.revisions[run.sourceRevisionId] ||
      run.candidateIds.some((id) => candidates[id]?.generationRunId !== run.id)
    )
      return false;
  }
  for (const candidate of Object.values(document.candidates)) {
    if (
      !document.generationRuns[candidate.generationRunId] ||
      !document.revisions[candidate.revisionId] ||
      candidate.atomicChangeIds.some((id) => atomicChanges[id]?.candidateId !== candidate.id)
    )
      return false;
  }
  const snapshot = document.revisions[document.currentRevisionId].snapshot;
  return (
    JSON.stringify(snapshot) ===
    JSON.stringify({
      screens: document.screens,
      nodes: document.nodes,
      transitions: document.transitions,
      branches: document.branches,
      activeBranchId: document.activeBranchId,
      activeScreenId: document.activeScreenId,
      entities: document.entities,
      representations: document.representations,
      pinnedNodeIds: document.pinnedNodeIds,
      frameFidelity: document.frameFidelity,
      nodeFidelityOverrides: document.nodeFidelityOverrides,
    })
  );
}

export function isProjectEnvelopeV2(value: unknown): value is ProjectEnvelopeV2 {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<ProjectEnvelopeV2>;
  if (envelope.version !== 2 || !Array.isArray(envelope.projects) || !envelope.projects.length)
    return false;
  const ids = new Set<string>();
  for (const project of envelope.projects) {
    if (
      !project ||
      typeof project.id !== 'string' ||
      !project.id ||
      typeof project.name !== 'string' ||
      !project.name.trim() ||
      !isDesignDocumentV2(project.document) ||
      ids.has(project.id)
    )
      return false;
    ids.add(project.id);
  }
  return typeof envelope.activeProjectId === 'string' && ids.has(envelope.activeProjectId);
}

/** Recovers generation runs written by earlier v2 builds before the scope model was split. */
export function recoverProjectEnvelopeV2(value: unknown): ProjectEnvelopeV2 | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 2 || !Array.isArray(source.projects)) return null;
  const envelope = clone(source) as unknown as ProjectEnvelopeV2;
  for (const project of envelope.projects ?? []) {
    const document = project.document;
    if (!document?.generationRuns || !document.revisions) continue;
    for (const [runId, typedRun] of Object.entries(document.generationRuns)) {
      const run = typedRun as unknown as Record<string, unknown>;
      const sourceRevisionId = String(run.sourceRevisionId ?? '');
      const snapshot = document.revisions[sourceRevisionId]?.snapshot;
      const legacyObservation = run.observationScope as
        { kind?: string; rootId?: string; nodeIds?: string[] } | undefined;
      const legacyMutationIds = Array.isArray(run.mutationScopeIds)
        ? run.mutationScopeIds.filter((id): id is string => typeof id === 'string')
        : [];
      if (!run.target && legacyObservation?.nodeIds?.length && legacyMutationIds.length) {
        const focusNodes = legacyMutationIds
          .map((id) => snapshot?.nodes[id])
          .filter((node): node is DesignNode => Boolean(node));
        const insertionParentIds = [
          ...new Set(
            focusNodes
              .map((node) => {
                if (node.kind === 'frame' || node.kind === 'group') return node.id;
                const parent = node.parentId ? snapshot?.nodes[node.parentId] : undefined;
                return parent && (parent.kind === 'frame' || parent.kind === 'group')
                  ? parent.id
                  : undefined;
              })
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        run.target = {
          focusNodeIds: legacyMutationIds,
          observationScope: {
            kind: legacyObservation.kind === 'page' ? 'screen' : legacyObservation.kind,
            rootId: legacyObservation.rootId,
            nodeIds: legacyObservation.nodeIds,
          },
          mutationScope: {
            existingNodeIds: legacyMutationIds.filter(
              (id) => !typedRun.pinnedNodeIds?.includes(id),
            ),
            insertionParentIds,
            regions: focusNodes.map((node) => ({ ...node.bounds })),
            allowCreate: true,
          },
        };
      }
      const target = run.target as
        { observationScope?: { nodeIds?: string[]; rootId?: string } } | undefined;
      run.contextNodeIds ??= target?.observationScope?.nodeIds ?? [];
      run.contextRootId ??= target?.observationScope?.rootId;
      run.contextSummarized ??= false;
      const legacyBackend = run.backend;
      const legacyProvider = run.provider;
      const legacyFallback = run.fallback === true;
      if (legacyBackend === 'local' || legacyProvider === 'local') {
        run.provider = 'legacy';
        run.legacyProvider = { id: 'local', fallback: legacyFallback };
      } else {
        run.provider = 'codex';
      }
      delete run.backend;
      delete run.fallback;
      run.contextSchemaVersion ??= 'codesign-scene-context-v1-legacy-recovered';
      delete run.observationScope;
      delete run.mutationScopeIds;
      document.generationRuns[runId] = run as unknown as DesignDocument['generationRuns'][string];
    }
  }
  return isProjectEnvelopeV2(envelope) ? envelope : null;
}
