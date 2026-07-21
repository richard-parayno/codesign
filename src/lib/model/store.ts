import { get, writable } from 'svelte/store';
import {
  isDesignDocumentV2,
  isLegacyDesignDocumentV1,
  isLegacyProjectEnvelopeV1,
  isProjectEnvelopeV2,
  migrateDocumentV1,
  migrateProjectEnvelopeV1,
  recoverProjectEnvelopeV2,
  type ProjectEnvelopeV2,
  type ProjectSummary,
} from './migration';
import { appendProcessEvent, applyOperation, applyOperationBatch } from './operations';
import {
  blankDocument,
  defaultStyle,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
} from './types';

export const LEGACY_DOCUMENT_KEY = 'malleable.document.v1';
export const LEGACY_PROJECT_STORAGE_KEY = 'malleable.projects.v1';
export const PROJECT_STORAGE_KEY = 'codesign.projects.v2';
const DEFAULT_PROJECT_ID = 'project-default';
const DEFAULT_PROJECT_NAME = 'Untitled design';

export type { ProjectSummary } from './migration';
export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type History = {
  past: DesignDocument[];
  present: DesignDocument;
  future: DesignDocument[];
  projects: ProjectSummary[];
  activeProjectId: string;
  warning: string | null;
};

const defaultProject = (): ProjectSummary => ({
  id: DEFAULT_PROJECT_ID,
  name: DEFAULT_PROJECT_NAME,
});

function initialState(): History {
  const project = defaultProject();
  return {
    past: [],
    present: blankDocument(),
    future: [],
    projects: [project],
    activeProjectId: project.id,
    warning: null,
  };
}

function readJson(storage: ProjectStorage, key: string) {
  const raw = storage.getItem(key);
  if (!raw) return { present: false as const, value: null, validJson: true as const };
  try {
    return { present: true as const, value: JSON.parse(raw) as unknown, validJson: true as const };
  } catch {
    return { present: true as const, value: null, validJson: false as const };
  }
}

function saveEnvelope(
  storage: ProjectStorage,
  state: Pick<History, 'projects' | 'activeProjectId'>,
  documents: Map<string, DesignDocument>,
) {
  const envelope: ProjectEnvelopeV2 = {
    version: 2,
    projects: state.projects.map((project) => ({
      ...project,
      document: documents.get(project.id) ?? blankDocument(),
    })),
    activeProjectId: state.activeProjectId,
  };
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(envelope));
}

function makeProjectId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `project-${suffix}`;
}

function normalizedName(name: string) {
  return name.trim().slice(0, 80);
}

function normalizeNodeStyle(node: DesignNode) {
  node.style = { ...defaultStyle, ...node.style };
}

function normalizeProjectComponentNames(
  nodes: DesignDocument['nodes'],
  projectComponents: DesignDocument['projectComponents'],
) {
  for (const node of Object.values(nodes)) {
    if (node.projectComponent?.role !== 'main') continue;
    const definition = projectComponents?.[node.projectComponent.componentId];
    if (!definition) continue;
    node.name = definition.name;
    if (definition.nodes[definition.sourceNodeId])
      definition.nodes[definition.sourceNodeId].name = definition.name;
  }
}

/**
 * v2 style schemas gained editor-facing fields without changing the storage version.
 * Validation accepts older v2 payloads through schema defaults, so restoration must
 * materialize those defaults on every canvas snapshot that can become active later.
 */
function normalizeRestoredDocument(source: DesignDocument) {
  const document = structuredClone(source);
  Object.values(document.nodes).forEach(normalizeNodeStyle);
  normalizeProjectComponentNames(document.nodes, document.projectComponents);
  Object.values(document.revisions).forEach((revision) => {
    Object.values(revision.snapshot.nodes).forEach(normalizeNodeStyle);
    normalizeProjectComponentNames(revision.snapshot.nodes, revision.snapshot.projectComponents);
  });
  return document;
}

function stateFromEnvelope(envelope: ProjectEnvelopeV2, warning: string | null = null): History {
  const document =
    envelope.projects.find((project) => project.id === envelope.activeProjectId)?.document ??
    blankDocument();
  return {
    past: [],
    present: document,
    future: [],
    projects: envelope.projects.map(({ id, name }) => ({ id, name })),
    activeProjectId: envelope.activeProjectId,
    warning,
  };
}

function carryProcessLedger(target: DesignDocument, source: DesignDocument) {
  const document = structuredClone(target);
  document.revisions = {
    ...structuredClone(source.revisions),
    ...document.revisions,
  };
  document.generationRuns = structuredClone(source.generationRuns);
  document.candidates = structuredClone(source.candidates);
  document.atomicChanges = structuredClone(source.atomicChanges);
  document.processEvents = structuredClone(source.processEvents);
  document.legacyArchive = structuredClone(source.legacyArchive ?? target.legacyArchive);
  return document;
}

export function createDocumentStore(injectedStorage?: ProjectStorage) {
  const initial = initialState();
  const store = writable<History>(initial);
  let documents = new Map<string, DesignDocument>([[initial.activeProjectId, initial.present]]);
  let histories = new Map<string, Pick<History, 'past' | 'present' | 'future'>>();
  const storage = () =>
    injectedStorage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);

  function persistState(state: History) {
    const target = storage();
    if (!target) return null;
    try {
      documents.set(state.activeProjectId, state.present);
      saveEnvelope(target, state, documents);
      return null;
    } catch {
      return 'Codesign could not save projects. Changes remain available in this session.';
    }
  }

  function commit(change: (state: History) => History) {
    store.update((state) => {
      const next = change(state);
      const warning = persistState(next);
      return warning ? { ...next, warning } : next;
    });
  }

  function activateEnvelope(envelope: ProjectEnvelopeV2, warning: string | null = null) {
    const normalizedEnvelope: ProjectEnvelopeV2 = {
      ...envelope,
      projects: envelope.projects.map((project) => ({
        ...project,
        document: normalizeRestoredDocument(project.document),
      })),
    };
    documents = new Map(
      normalizedEnvelope.projects.map((project) => [project.id, project.document]),
    );
    histories = new Map();
    const restored = stateFromEnvelope(normalizedEnvelope, warning);
    store.set(restored);
    return restored;
  }

  return {
    subscribe: store.subscribe,
    apply(operation: DesignOperation) {
      commit((state) => ({
        ...state,
        past: [...state.past.slice(-49), state.present],
        present: applyOperation(state.present, operation),
        future: [],
      }));
    },
    applyBatch(operations: DesignOperation[], transactionId?: string) {
      if (!operations.length) return;
      commit((state) => ({
        ...state,
        past: [...state.past.slice(-49), state.present],
        present: applyOperationBatch(state.present, operations, {
          transactionId: transactionId ?? `editor-${operations[0].id}`,
        }),
        future: [],
      }));
    },
    undo() {
      commit((state) =>
        state.past.length
          ? (() => {
              const present = carryProcessLedger(state.past.at(-1)!, state.present);
              appendProcessEvent(present, {
                type: 'reverted',
                actor: 'user',
                timestamp: Date.now(),
                revisionId: present.currentRevisionId,
                details: { fromRevisionId: state.present.currentRevisionId },
              });
              return {
                ...state,
                past: state.past.slice(0, -1),
                present,
                future: [state.present, ...state.future],
              };
            })()
          : state,
      );
    },
    redo() {
      commit((state) =>
        state.future.length
          ? (() => {
              const present = carryProcessLedger(state.future[0], state.present);
              appendProcessEvent(present, {
                type: 'revision-activated',
                actor: 'user',
                timestamp: Date.now(),
                revisionId: present.currentRevisionId,
                details: { source: 'redo' },
              });
              return {
                ...state,
                past: [...state.past, state.present],
                present,
                future: state.future.slice(1),
              };
            })()
          : state,
      );
    },
    replace(document: DesignDocument) {
      if (!isDesignDocumentV2(document)) throw new Error('Replacement document is invalid');
      commit((state) => ({ ...state, past: [], present: document, future: [] }));
    },
    replaceMetadata(document: DesignDocument) {
      if (!isDesignDocumentV2(document)) throw new Error('Replacement document is invalid');
      commit((state) => ({ ...state, present: document }));
    },
    commitRevision(document: DesignDocument) {
      if (!isDesignDocumentV2(document)) throw new Error('Committed document is invalid');
      commit((state) => ({
        ...state,
        past: [...state.past.slice(-49), state.present],
        present: document,
        future: [],
      }));
    },
    navigate(screenId: string, branchId?: string) {
      commit((state) => {
        if (!state.present.screens.some((screen) => screen.id === screenId)) return state;
        const activeBranchId = branchId ?? state.present.activeBranchId;
        if (!state.present.branches.some((branch) => branch.id === activeBranchId)) return state;
        const present = structuredClone(state.present);
        present.activeScreenId = screenId;
        present.activeBranchId = activeBranchId;
        const snapshot = present.revisions[present.currentRevisionId].snapshot;
        snapshot.activeScreenId = screenId;
        snapshot.activeBranchId = activeBranchId;
        return { ...state, present };
      });
    },
    reset() {
      commit((state) => ({ ...state, past: [], present: blankDocument(), future: [] }));
    },
    restore() {
      const target = storage();
      if (!target) return;
      let warning: string | null = null;
      try {
        const v2 = readJson(target, PROJECT_STORAGE_KEY);
        const recoveredV2 = v2.present ? recoverProjectEnvelopeV2(v2.value) : null;
        if (recoveredV2 && isProjectEnvelopeV2(recoveredV2)) {
          activateEnvelope(recoveredV2);
          return;
        }
        if (v2.present)
          warning = 'Stored Codesign project data was invalid. Legacy recovery was attempted.';

        const v1Projects = readJson(target, LEGACY_PROJECT_STORAGE_KEY);
        if (v1Projects.present && isLegacyProjectEnvelopeV1(v1Projects.value)) {
          const migrated = migrateProjectEnvelopeV1(v1Projects.value, LEGACY_PROJECT_STORAGE_KEY);
          saveEnvelope(
            target,
            {
              projects: migrated.projects.map(({ id, name }) => ({ id, name })),
              activeProjectId: migrated.activeProjectId,
            },
            new Map(migrated.projects.map((project) => [project.id, project.document])),
          );
          activateEnvelope(migrated, warning);
          return;
        }
        if (v1Projects.present)
          warning = 'Legacy project data could not be migrated and was left untouched.';

        const legacyDocument = readJson(target, LEGACY_DOCUMENT_KEY);
        if (legacyDocument.present && isLegacyDesignDocumentV1(legacyDocument.value)) {
          const document = migrateDocumentV1(legacyDocument.value, LEGACY_DOCUMENT_KEY);
          const envelope: ProjectEnvelopeV2 = {
            version: 2,
            activeProjectId: DEFAULT_PROJECT_ID,
            projects: [{ ...defaultProject(), document }],
          };
          saveEnvelope(
            target,
            { projects: [defaultProject()], activeProjectId: DEFAULT_PROJECT_ID },
            new Map([[DEFAULT_PROJECT_ID, document]]),
          );
          activateEnvelope(envelope, warning);
          return;
        }
        if (legacyDocument.present)
          warning = 'Legacy design data could not be migrated and was left untouched.';

        const blank = initialState();
        blank.warning = warning;
        documents = new Map([[blank.activeProjectId, blank.present]]);
        histories = new Map();
        store.set(blank);
        if (v2.present) return;
        try {
          saveEnvelope(target, blank, documents);
        } catch {
          store.set({
            ...blank,
            warning: warning ?? 'Codesign could not initialize persistent project storage.',
          });
        }
      } catch {
        // Raw legacy keys are intentionally never removed or overwritten on recovery failure.
        const blank = initialState();
        blank.warning = 'Projects could not be restored. Stored legacy data was left untouched.';
        documents = new Map([[blank.activeProjectId, blank.present]]);
        histories = new Map();
        store.set(blank);
      }
    },
    createProject(name: string) {
      const projectName = normalizedName(name);
      if (!projectName) return null;
      const project: ProjectSummary = { id: makeProjectId(), name: projectName };
      const current = get(store);
      histories.set(current.activeProjectId, {
        past: current.past,
        present: current.present,
        future: current.future,
      });
      const document = blankDocument();
      documents.set(project.id, document);
      commit((state) => ({
        past: [],
        present: document,
        future: [],
        projects: [...state.projects, project],
        activeProjectId: project.id,
        warning: state.warning,
      }));
      return project;
    },
    renameProject(projectId: string, name: string) {
      const projectName = normalizedName(name);
      if (!projectName) return false;
      const state = get(store);
      if (!state.projects.some((project) => project.id === projectId)) return false;
      commit((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId ? { ...project, name: projectName } : project,
        ),
      }));
      return true;
    },
    switchProject(projectId: string) {
      const current = get(store);
      if (
        current.activeProjectId === projectId ||
        !current.projects.some((project) => project.id === projectId)
      )
        return false;
      histories.set(current.activeProjectId, {
        past: current.past,
        present: current.present,
        future: current.future,
      });
      documents.set(current.activeProjectId, current.present);
      const targetHistory = histories.get(projectId);
      const document = targetHistory?.present ?? documents.get(projectId) ?? blankDocument();
      const next = {
        ...current,
        past: targetHistory?.past ?? [],
        present: document,
        future: targetHistory?.future ?? [],
        activeProjectId: projectId,
      };
      const warning = persistState(next);
      store.set(warning ? { ...next, warning } : next);
      return true;
    },
    deleteProject(projectId: string) {
      const current = get(store);
      const removed = current.projects.find((project) => project.id === projectId);
      if (!removed) return null;
      const remaining = current.projects.filter((project) => project.id !== projectId);
      let projects = remaining;
      if (!projects.length) projects = [{ id: makeProjectId(), name: DEFAULT_PROJECT_NAME }];
      const activeProjectId =
        current.activeProjectId === projectId ? projects[0].id : current.activeProjectId;
      let present = current.present;
      let past = current.past;
      let future = current.future;
      if (current.activeProjectId === projectId) {
        const targetHistory = histories.get(activeProjectId);
        present = targetHistory?.present ?? documents.get(activeProjectId) ?? blankDocument();
        past = targetHistory?.past ?? [];
        future = targetHistory?.future ?? [];
      }
      documents.delete(projectId);
      histories.delete(projectId);
      documents.set(activeProjectId, present);
      const next = { ...current, past, present, future, projects, activeProjectId };
      const warning = persistState(next);
      store.set(warning ? { ...next, warning } : next);
      return { removed, activeProjectId };
    },
  };
}

export const documentStore = createDocumentStore();
