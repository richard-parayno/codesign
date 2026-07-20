import { get, writable } from 'svelte/store';
import { applyOperation } from './operations';
import {
  blankDocument,
  nodeSchema,
  operationSchema,
  type DesignDocument,
  type DesignOperation,
} from './types';

export const LEGACY_DOCUMENT_KEY = 'malleable.document.v1';
export const PROJECT_STORAGE_KEY = 'malleable.projects.v1';
const DEFAULT_PROJECT_ID = 'project-default';
const DEFAULT_PROJECT_NAME = 'Untitled design';

export type ProjectSummary = { id: string; name: string };
export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type History = {
  past: DesignDocument[];
  present: DesignDocument;
  future: DesignDocument[];
  projects: ProjectSummary[];
  activeProjectId: string;
};
type ProjectEnvelope = {
  version: 1;
  activeProjectId: string;
  projects: Array<ProjectSummary & { document: DesignDocument }>;
};

function isDesignDocument(value: unknown): value is DesignDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<DesignDocument>;
  if (
    document.version !== 1 ||
    !Number.isInteger(document.revision) ||
    document.revision! < 0 ||
    !Array.isArray(document.screens) ||
    !document.screens.length ||
    !document.nodes ||
    typeof document.nodes !== 'object' ||
    !Array.isArray(document.transitions) ||
    !Array.isArray(document.branches) ||
    !document.branches.length ||
    typeof document.activeBranchId !== 'string' ||
    typeof document.activeScreenId !== 'string' ||
    !Array.isArray(document.hypotheses) ||
    !Array.isArray(document.operations)
  )
    return false;

  const screensValid = document.screens.every(
    (screen) =>
      !!screen &&
      typeof screen.id === 'string' &&
      !!screen.id &&
      typeof screen.name === 'string' &&
      typeof screen.branchId === 'string' &&
      Array.isArray(screen.rootIds) &&
      screen.rootIds.every((id) => typeof id === 'string'),
  );
  const branchesValid = document.branches.every(
    (branch) =>
      !!branch &&
      typeof branch.id === 'string' &&
      !!branch.id &&
      typeof branch.name === 'string' &&
      Array.isArray(branch.screenIds) &&
      branch.screenIds.every((id) => typeof id === 'string'),
  );
  if (!screensValid || !branchesValid) return false;

  const screenIds = new Set(document.screens.map((screen) => screen.id));
  const branchIds = new Set(document.branches.map((branch) => branch.id));
  if (!screenIds.has(document.activeScreenId) || !branchIds.has(document.activeBranchId))
    return false;
  if (
    document.screens.some(
      (screen) =>
        !branchIds.has(screen.branchId) ||
        !document.branches!.some(
          (branch) => branch.id === screen.branchId && branch.screenIds.includes(screen.id),
        ),
    )
  )
    return false;

  const nodes = Object.entries(document.nodes);
  if (
    nodes.some(
      ([id, node]) =>
        !nodeSchema.safeParse(node).success || node.id !== id || !screenIds.has(node.screenId),
    )
  )
    return false;
  if (
    document.screens.some((screen) => screen.rootIds.some((id) => !document.nodes![id])) ||
    nodes.some(([, node]) => node.childIds.some((id) => !document.nodes![id]))
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

function isProjectEnvelope(value: unknown): value is ProjectEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<ProjectEnvelope>;
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
      !isDesignDocument(project.document) ||
      ids.has(project.id)
    )
      return false;
    ids.add(project.id);
  }
  return typeof envelope.activeProjectId === 'string' && ids.has(envelope.activeProjectId);
}

function parseStored<T>(
  storage: ProjectStorage,
  key: string,
  validate: (value: unknown) => value is T,
) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (validate(value)) return value;
  } catch {
    // Invalid local data is removed below and replaced with a safe blank document.
  }
  storage.removeItem(key);
  return null;
}

function saveEnvelope(
  storage: ProjectStorage,
  state: Pick<History, 'projects' | 'activeProjectId'>,
  documents: Map<string, DesignDocument>,
) {
  const envelope: ProjectEnvelope = {
    version: 1,
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

const defaultProject: ProjectSummary = { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME };
const initial: History = {
  past: [],
  present: blankDocument(),
  future: [],
  projects: [defaultProject],
  activeProjectId: defaultProject.id,
};

export function createDocumentStore(injectedStorage?: ProjectStorage) {
  const store = writable<History>(initial);
  let documents = new Map<string, DesignDocument>([[defaultProject.id, initial.present]]);
  let histories = new Map<string, Pick<History, 'past' | 'present' | 'future'>>();
  const storage = () =>
    injectedStorage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);

  function persistState(state: History) {
    const target = storage();
    if (!target) return;
    try {
      documents.set(state.activeProjectId, state.present);
      saveEnvelope(target, state, documents);
    } catch {
      // The in-memory editor remains usable when browser storage is unavailable.
    }
  }

  function commit(change: (state: History) => History) {
    store.update((state) => {
      const next = change(state);
      persistState(next);
      return next;
    });
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
    undo() {
      commit((state) =>
        state.past.length
          ? {
              ...state,
              past: state.past.slice(0, -1),
              present: state.past.at(-1)!,
              future: [state.present, ...state.future],
            }
          : state,
      );
    },
    redo() {
      commit((state) =>
        state.future.length
          ? {
              ...state,
              past: [...state.past, state.present],
              present: state.future[0],
              future: state.future.slice(1),
            }
          : state,
      );
    },
    replace(document: DesignDocument) {
      commit((state) => ({ ...state, past: [], present: document, future: [] }));
    },
    navigate(screenId: string, branchId?: string) {
      commit((state) => ({
        ...state,
        present: {
          ...state.present,
          activeScreenId: screenId,
          activeBranchId: branchId ?? state.present.activeBranchId,
        },
      }));
    },
    reset() {
      commit((state) => ({ ...state, past: [], present: blankDocument(), future: [] }));
    },
    restore() {
      const target = storage();
      if (!target) return;
      try {
        const envelope = parseStored(target, PROJECT_STORAGE_KEY, isProjectEnvelope);
        if (envelope) {
          documents = new Map(envelope.projects.map((project) => [project.id, project.document]));
          histories = new Map();
          const restored = {
            past: [],
            present: documents.get(envelope.activeProjectId) ?? blankDocument(),
            future: [],
            projects: envelope.projects.map(({ id, name }) => ({ id, name })),
            activeProjectId: envelope.activeProjectId,
          };
          store.set(restored);
          persistState(restored);
          return;
        }

        const legacy = parseStored(target, LEGACY_DOCUMENT_KEY, isDesignDocument);
        const migrated = {
          ...initial,
          present: legacy ?? blankDocument(),
          projects: [{ ...defaultProject }],
        };
        documents = new Map([[migrated.activeProjectId, migrated.present]]);
        histories = new Map();
        saveEnvelope(target, migrated, documents);
        if (legacy) target.removeItem(LEGACY_DOCUMENT_KEY);
        store.set(migrated);
      } catch {
        // Keep the safe initial state if localStorage cannot be read.
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
      store.set(next);
      persistState(next);
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
      const next = { past, present, future, projects, activeProjectId };
      store.set(next);
      persistState(next);
      return { removed, activeProjectId };
    },
  };
}

export const documentStore = createDocumentStore();
