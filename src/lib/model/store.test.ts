import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import {
  createDocumentStore,
  LEGACY_DOCUMENT_KEY,
  PROJECT_STORAGE_KEY,
  type ProjectStorage,
} from './store';
import { blankDocument, defaultStyle, type DesignOperation } from './types';

class MemoryStorage implements ProjectStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function createRectangle(id: string): DesignOperation {
  return {
    id: `create-${id}`,
    type: 'create',
    actor: 'user',
    node: {
      id,
      name: id,
      kind: 'rectangle',
      screenId: 'screen-1',
      childIds: [],
      bounds: { x: 10, y: 10, width: 100, height: 50 },
      style: { ...defaultStyle },
      provenance: { actor: 'user', operationId: `create-${id}` },
    },
  };
}

describe('project document store', () => {
  it('migrates the legacy document once into the project envelope', () => {
    const storage = new MemoryStorage();
    const legacy = { ...blankDocument(), revision: 7 };
    storage.setItem(LEGACY_DOCUMENT_KEY, JSON.stringify(legacy));

    const store = createDocumentStore(storage);
    store.restore();

    expect(get(store).present.revision).toBe(7);
    expect(get(store).projects).toEqual([{ id: 'project-default', name: 'Untitled design' }]);
    expect(storage.getItem(LEGACY_DOCUMENT_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(PROJECT_STORAGE_KEY)!)).toMatchObject({
      version: 1,
      activeProjectId: 'project-default',
      projects: [{ id: 'project-default', name: 'Untitled design', document: { revision: 7 } }],
    });

    storage.setItem(LEGACY_DOCUMENT_KEY, JSON.stringify({ ...legacy, revision: 99 }));
    const reloaded = createDocumentStore(storage);
    reloaded.restore();
    expect(get(reloaded).present.revision).toBe(7);
  });

  it('persists separate documents and restores the active project after reload', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    store.apply(createRectangle('first-file-node'));
    const firstProjectId = get(store).activeProjectId;

    const second = store.createProject('Checkout flow');
    expect(second).not.toBeNull();
    store.apply(createRectangle('second-file-node'));
    store.renameProject(second!.id, 'Checkout prototype');

    expect(get(store).present.nodes['second-file-node']).toBeDefined();
    expect(get(store).present.nodes['first-file-node']).toBeUndefined();
    expect(store.switchProject(firstProjectId)).toBe(true);
    expect(get(store).present.nodes['first-file-node']).toBeDefined();
    expect(get(store).present.nodes['second-file-node']).toBeUndefined();
    store.switchProject(second!.id);

    const reloaded = createDocumentStore(storage);
    reloaded.restore();
    expect(get(reloaded).activeProjectId).toBe(second!.id);
    expect(get(reloaded).projects.find((project) => project.id === second!.id)?.name).toBe(
      'Checkout prototype',
    );
    expect(get(reloaded).present.nodes['second-file-node']).toBeDefined();
  });

  it('keeps undo history per project during a session', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    const firstProjectId = get(store).activeProjectId;
    store.apply(createRectangle('first-file-node'));

    const second = store.createProject('Second')!;
    store.apply(createRectangle('second-file-node'));
    store.switchProject(firstProjectId);
    store.undo();
    expect(get(store).present.nodes['first-file-node']).toBeUndefined();

    store.switchProject(second.id);
    expect(get(store).present.nodes['second-file-node']).toBeDefined();
    store.undo();
    expect(get(store).present.nodes['second-file-node']).toBeUndefined();
  });

  it('deleting the last project immediately creates a blank replacement', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    store.apply(createRectangle('discarded'));

    const result = store.deleteProject(get(store).activeProjectId);

    expect(result).not.toBeNull();
    expect(get(store).projects).toHaveLength(1);
    expect(get(store).activeProjectId).not.toBe(result!.removed.id);
    expect(get(store).present).toEqual(blankDocument());
  });

  it('recovers from corrupt project storage with one safe project', () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_STORAGE_KEY, '{not-json');
    storage.setItem(LEGACY_DOCUMENT_KEY, 'also-not-json');

    const store = createDocumentStore(storage);
    expect(() => store.restore()).not.toThrow();
    expect(get(store).projects).toHaveLength(1);
    expect(get(store).present).toEqual(blankDocument());
    expect(JSON.parse(storage.getItem(PROJECT_STORAGE_KEY)!)).toMatchObject({ version: 1 });
  });

  it('rejects structurally incomplete documents before they reach the editor', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeProjectId: 'broken',
        projects: [
          {
            id: 'broken',
            name: 'Broken project',
            document: { ...blankDocument(), screens: [] },
          },
        ],
      }),
    );

    const store = createDocumentStore(storage);
    expect(() => store.restore()).not.toThrow();
    expect(get(store).projects).toEqual([{ id: 'project-default', name: 'Untitled design' }]);
    expect(get(store).present).toEqual(blankDocument());
  });

  it('continues in memory when browser storage is unavailable', () => {
    const unavailable: ProjectStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    const store = createDocumentStore(unavailable);

    expect(() => store.restore()).not.toThrow();
    expect(() => store.apply(createRectangle('in-memory'))).not.toThrow();
    expect(get(store).present.nodes['in-memory']).toBeDefined();
    expect(store.createProject('Still usable')).not.toBeNull();
    expect(get(store).projects).toHaveLength(2);
  });
});
