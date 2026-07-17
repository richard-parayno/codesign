import { writable } from 'svelte/store';
import { applyOperation } from './operations';
import { blankDocument, type DesignDocument, type DesignOperation } from './types';

const STORAGE_KEY = 'malleable.document.v1';
type History = { past: DesignDocument[]; present: DesignDocument; future: DesignDocument[] };
const initial: History = { past: [], present: blankDocument(), future: [] };

function createDocumentStore() {
  const { subscribe, set, update } = writable(initial);
  return {
    subscribe,
    apply(operation: DesignOperation) {
      update((state) => ({
        past: [...state.past.slice(-49), state.present],
        present: applyOperation(state.present, operation),
        future: [],
      }));
    },
    undo() {
      update((state) =>
        state.past.length
          ? {
              past: state.past.slice(0, -1),
              present: state.past.at(-1)!,
              future: [state.present, ...state.future],
            }
          : state,
      );
    },
    redo() {
      update((state) =>
        state.future.length
          ? {
              past: [...state.past, state.present],
              present: state.future[0],
              future: state.future.slice(1),
            }
          : state,
      );
    },
    replace(document: DesignDocument) {
      set({ past: [], present: document, future: [] });
    },
    navigate(screenId: string, branchId?: string) {
      update((state) => ({
        ...state,
        present: {
          ...state.present,
          activeScreenId: screenId,
          activeBranchId: branchId ?? state.present.activeBranchId,
        },
      }));
    },
    reset() {
      set({ past: [], present: blankDocument(), future: [] });
    },
    restore() {
      if (typeof localStorage === 'undefined') return;
      try {
        const value = JSON.parse(
          localStorage.getItem(STORAGE_KEY) ?? 'null',
        ) as DesignDocument | null;
        if (value?.version === 1 && value.screens && value.nodes)
          set({ past: [], present: value, future: [] });
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    persist(document: DesignDocument) {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    },
  };
}
export const documentStore = createDocumentStore();
