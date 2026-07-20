import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { setNodePinned } from './codesign';
import { applyOperation } from './operations';
import type { LegacyDesignDocumentV1 } from './types';
import {
  createDocumentStore,
  LEGACY_DOCUMENT_KEY,
  LEGACY_PROJECT_STORAGE_KEY,
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

function legacyDocument(revision = 0): LegacyDesignDocumentV1 {
  const document = blankDocument();
  return {
    version: 1,
    revision,
    screens: structuredClone(document.screens),
    nodes: {},
    transitions: [],
    branches: structuredClone(document.branches),
    activeBranchId: document.activeBranchId,
    activeScreenId: document.activeScreenId,
    hypotheses: [],
    operations: [],
  };
}

describe('project document store', () => {
  it('migrates the legacy single document without deleting its recovery source', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_DOCUMENT_KEY, JSON.stringify(legacyDocument(7)));

    const store = createDocumentStore(storage);
    store.restore();

    expect(get(store).present.version).toBe(2);
    expect(get(store).present.revision).toBe(7);
    expect(get(store).present.legacyArchive?.sourceKey).toBe(LEGACY_DOCUMENT_KEY);
    expect(storage.getItem(LEGACY_DOCUMENT_KEY)).not.toBeNull();
    expect(JSON.parse(storage.getItem(PROJECT_STORAGE_KEY)!)).toMatchObject({
      version: 2,
      activeProjectId: 'project-default',
      projects: [{ id: 'project-default', name: 'Untitled design', document: { version: 2 } }],
    });
  });

  it('migrates every v1 project and preserves active project metadata', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_PROJECT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeProjectId: 'second',
        projects: [
          { id: 'first', name: 'First', document: legacyDocument(1) },
          { id: 'second', name: 'Second', document: legacyDocument(2) },
        ],
      }),
    );

    const store = createDocumentStore(storage);
    store.restore();

    expect(get(store).projects).toEqual([
      { id: 'first', name: 'First' },
      { id: 'second', name: 'Second' },
    ]);
    expect(get(store).activeProjectId).toBe('second');
    expect(get(store).present.revision).toBe(2);
    expect(storage.getItem(LEGACY_PROJECT_STORAGE_KEY)).not.toBeNull();
  });

  it('persists separate v2 documents and restores the active project after reload', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    store.apply(createRectangle('first-file-node'));
    const firstProjectId = get(store).activeProjectId;

    const second = store.createProject('Checkout flow')!;
    store.apply(createRectangle('second-file-node'));
    store.renameProject(second.id, 'Checkout prototype');
    store.switchProject(firstProjectId);
    expect(get(store).present.nodes['first-file-node']).toBeDefined();
    store.switchProject(second.id);

    const reloaded = createDocumentStore(storage);
    reloaded.restore();
    expect(get(reloaded).activeProjectId).toBe(second.id);
    expect(get(reloaded).present.nodes['second-file-node']).toBeDefined();
    expect(get(reloaded).present.version).toBe(2);
  });

  it('materializes new style defaults when restoring an older v2 project', () => {
    const storage = new MemoryStorage();
    const document = applyOperation(blankDocument(), createRectangle('legacy-style-node'));
    const node = document.nodes['legacy-style-node'];
    const revisionNode =
      document.revisions[document.currentRevisionId].snapshot.nodes['legacy-style-node'];
    for (const target of [node, revisionNode]) {
      const oldStyle = target.style as Partial<typeof target.style>;
      delete oldStyle.opacity;
      delete oldStyle.fontWeight;
      delete oldStyle.textAlign;
      delete oldStyle.lineHeight;
    }
    storage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: 'older-v2',
        projects: [{ id: 'older-v2', name: 'Older v2', document }],
      }),
    );

    const store = createDocumentStore(storage);
    store.restore();

    expect(get(store).present.nodes['legacy-style-node'].style).toMatchObject({
      opacity: 1,
      fontWeight: 400,
      textAlign: 'left',
      lineHeight: 1.4,
    });
    expect(get(store).present.nodes['legacy-style-node'].style.strokeWidth).toBeUndefined();
    expect(
      get(store).present.revisions[document.currentRevisionId].snapshot.nodes['legacy-style-node']
        .style.opacity,
    ).toBe(1);
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
  });

  it('commits an editor transaction as one undoable history step', () => {
    const store = createDocumentStore(new MemoryStorage());
    store.restore();

    store.applyBatch(
      [createRectangle('batch-a'), createRectangle('batch-b')],
      'editor-duplicate-selection',
    );
    expect(Object.keys(get(store).present.nodes)).toEqual(['batch-a', 'batch-b']);
    expect(get(store).present.revision).toBe(1);

    store.undo();
    expect(Object.keys(get(store).present.nodes)).toEqual([]);
    store.redo();
    expect(Object.keys(get(store).present.nodes)).toEqual(['batch-a', 'batch-b']);
  });

  it('persists lifecycle metadata without clearing direct-edit undo history', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    store.apply(createRectangle('editable'));
    store.replaceMetadata(setNodePinned(get(store).present, 'editable', true, 10));

    expect(get(store).present.pinnedNodeIds).toEqual(['editable']);
    store.undo();
    expect(get(store).present.nodes.editable).toBeUndefined();
    expect(get(store).present.processEvents.some((event) => event.type === 'pin-changed')).toBe(
      true,
    );
    expect(get(store).present.processEvents.at(-1)?.type).toBe('reverted');
  });

  it('commits an accepted revision as one undoable step without rewinding the process ledger', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    store.apply(createRectangle('source'));
    const accepted = applyOperation(get(store).present, createRectangle('accepted'));

    store.commitRevision(accepted);
    expect(get(store).present.nodes.accepted).toBeDefined();
    store.undo();
    expect(get(store).present.nodes.accepted).toBeUndefined();
    expect(get(store).present.processEvents.at(-1)?.type).toBe('reverted');
    store.redo();
    expect(get(store).present.nodes.accepted).toBeDefined();
    expect(get(store).present.processEvents.some((event) => event.type === 'reverted')).toBe(true);
  });

  it('deleting the last project immediately creates a blank v2 replacement', () => {
    const storage = new MemoryStorage();
    const store = createDocumentStore(storage);
    store.restore();
    store.apply(createRectangle('discarded'));

    const result = store.deleteProject(get(store).activeProjectId)!;

    expect(get(store).projects).toHaveLength(1);
    expect(get(store).activeProjectId).not.toBe(result.removed.id);
    expect(get(store).present).toEqual(blankDocument());
  });

  it('keeps corrupt sources recoverable and exposes a warning', () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_STORAGE_KEY, '{not-json');
    storage.setItem(LEGACY_PROJECT_STORAGE_KEY, '{also-not-json');
    storage.setItem(LEGACY_DOCUMENT_KEY, 'still-not-json');

    const store = createDocumentStore(storage);
    expect(() => store.restore()).not.toThrow();

    expect(get(store).present).toEqual(blankDocument());
    expect(get(store).warning).toContain('Legacy design data');
    expect(storage.getItem(PROJECT_STORAGE_KEY)).toBe('{not-json');
    expect(storage.getItem(LEGACY_PROJECT_STORAGE_KEY)).toBe('{also-not-json');
    expect(storage.getItem(LEGACY_DOCUMENT_KEY)).toBe('still-not-json');
  });

  it('continues in memory and warns when browser storage is unavailable', () => {
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
    expect(get(store).warning).toContain('could not be restored');
    expect(() => store.apply(createRectangle('in-memory'))).not.toThrow();
    expect(get(store).present.nodes['in-memory']).toBeDefined();
    expect(get(store).warning).toContain('could not save');
  });
});
