import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import {
  blankDocument,
  defaultStyle,
  type DesignDocument,
  type DesignNode,
} from '$lib/model/types';
import { CanvasSessionService } from './canvas-session.server';
import { CanvasSessionError, type CanvasSessionCreateInput } from './contracts';

function node(
  id: string,
  kind: DesignNode['kind'],
  bounds: DesignNode['bounds'],
  parentId?: string,
): DesignNode {
  return {
    id,
    name: id,
    kind,
    screenId: 'screen-1',
    parentId,
    childIds: [],
    bounds,
    style: { ...defaultStyle, fill: kind === 'frame' ? '#ffffff' : '#d9dde3' },
    provenance: { actor: 'user', operationId: `seed-${id}` },
  };
}

function sourceDocument() {
  let document = blankDocument();
  for (const item of [
    node('frame', 'frame', { x: 0, y: 0, width: 800, height: 600 }),
    node('group', 'group', { x: 20, y: 20, width: 300, height: 300 }, 'frame'),
    node('editable', 'rectangle', { x: 40, y: 40, width: 100, height: 100 }, 'group'),
    node('pinned-child', 'rectangle', { x: 160, y: 40, width: 100, height: 100 }, 'group'),
    node('unrelated', 'rectangle', { x: 500, y: 50, width: 100, height: 100 }, 'frame'),
  ])
    document = applyOperation(document, {
      id: `seed-${item.id}`,
      type: 'create',
      actor: 'user',
      node: item,
    });
  return document;
}

function input(document: DesignDocument, ttlMs?: number): CanvasSessionCreateInput {
  return {
    document,
    action: 'complete',
    requestedFidelity: 'component',
    pinnedNodeIds: ['pinned-child'],
    ttlMs,
    target: {
      focusNodeIds: ['group'],
      observationScope: {
        kind: 'frame',
        rootId: 'frame',
        nodeIds: ['frame', 'group', 'editable', 'pinned-child', 'unrelated'],
      },
      mutationScope: {
        existingNodeIds: ['group', 'editable'],
        insertionParentIds: ['frame', 'group'],
        regions: [{ x: 0, y: 0, width: 400, height: 500 }],
        allowCreate: true,
      },
    },
  };
}

function createChange(id: string, value: DesignNode, dependencyIds: string[] = []) {
  return {
    operation: {
      id,
      type: 'create' as const,
      actor: 'agent' as const,
      node: { ...value, provenance: { actor: 'agent' as const, operationId: id } },
    },
    dependencyIds,
    evidenceNodeIds: ['group'],
    summary: `Created ${value.name}`,
  };
}

describe('CanvasSessionService', () => {
  it('starts reroll candidates with pinned seed operations already applied', async () => {
    const document = sourceDocument();
    const service = new CanvasSessionService();
    const sessionInput = input(document);
    sessionInput.pinnedChangeIds = ['preserved-style'];
    sessionInput.seedChanges = [
      {
        operation: {
          id: 'preserved-style',
          type: 'style',
          actor: 'agent',
          targetIds: ['editable'],
          patch: { radius: 18 },
        },
        dependencyIds: [],
        evidenceNodeIds: ['editable'],
        summary: 'Preserved the approved corner radius.',
      },
    ];

    const session = await service.createSession(sessionInput);
    const state = (await service.dispatch(session.id, 'candidate.get_state', {
      nodeIds: ['editable'],
    })) as {
      pinnedChangeIds: string[];
      operations: { items: Array<{ id: string }> };
      nodes: { items: DesignNode[] };
    };

    expect(state.pinnedChangeIds).toEqual(['preserved-style']);
    expect(state.operations.items).toContainEqual(
      expect.objectContaining({ id: 'preserved-style' }),
    );
    expect(state.nodes.items[0].style.radius).toBe(18);
    await service.dispose();
  });

  it('keeps the accepted document immutable while mutating a candidate copy', async () => {
    const document = sourceDocument();
    const acceptedBefore = structuredClone(document);
    const service = new CanvasSessionService();
    const session = await service.createSession(input(document));
    await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: session.candidateRevisionId,
      changes: [
        {
          operation: {
            id: 'rename-editable',
            type: 'update-node',
            actor: 'agent',
            targetIds: ['editable'],
            patch: { name: 'Candidate rectangle' },
          },
          evidenceNodeIds: ['editable'],
          summary: 'Clarified the selected layer name.',
        },
      ],
    });
    const state = (await service.dispatch(session.id, 'candidate.get_state', {
      nodeIds: ['editable'],
    })) as { nodes: { items: Array<{ name: string }> } };
    expect(state.nodes.items[0].name).toBe('Candidate rectangle');
    expect(document).toEqual(acceptedBefore);
    await service.dispose();
  });

  it('assigns internal IDs, active screen, provenance, and defaults for compact creates', async () => {
    const document = sourceDocument();
    const service = new CanvasSessionService();
    const session = await service.createSession(input(document));

    const applied = (await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: session.candidateRevisionId,
      changes: [
        {
          operation: {
            type: 'create',
            name: 'Generated label',
            kind: 'text',
            parentId: 'group',
            bounds: { x: 60, y: 200, width: 160, height: 32 },
            text: 'Generated label',
            style: { textColor: '#ffffff' },
          },
          evidenceNodeIds: ['group'],
          summary: 'Added a readable label to the selected group.',
        },
      ],
    })) as { candidateRevisionId: string; appliedOperationIds: string[] };

    const state = (await service.dispatch(session.id, 'candidate.get_state', {})) as {
      nodes: { items: DesignNode[] };
    };
    const created = state.nodes.items.find((item) => item.name === 'Generated label');
    expect(applied.appliedOperationIds).toHaveLength(1);
    expect(created).toMatchObject({
      kind: 'text',
      screenId: document.activeScreenId,
      parentId: 'group',
      childIds: [],
      style: expect.objectContaining({ textColor: '#ffffff', opacity: 1 }),
      layout: expect.objectContaining({ mode: 'none', widthMode: 'fixed' }),
      provenance: {
        actor: 'agent',
        operationId: applied.appliedOperationIds[0],
      },
    });
    expect(created?.id).toMatch(/^candidate-node-/);
    await service.dispose();
  });

  it('rejects a stale candidate revision before applying any mutation', async () => {
    const service = new CanvasSessionService();
    const session = await service.createSession(input(sourceDocument()));
    const first = (await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: session.candidateRevisionId,
      changes: [
        {
          operation: {
            id: 'first-style',
            type: 'style',
            actor: 'agent',
            targetIds: ['editable'],
            patch: { radius: 8 },
          },
          evidenceNodeIds: ['editable'],
          summary: 'Applied the first candidate refinement.',
        },
      ],
    })) as { candidateRevisionId: string };
    await expect(
      service.dispatch(session.id, 'candidate.apply_changes', {
        candidateRevisionId: session.candidateRevisionId,
        changes: [
          {
            operation: {
              id: 'stale-style',
              type: 'style',
              actor: 'agent',
              targetIds: ['editable'],
              patch: { padding: 24 },
            },
            evidenceNodeIds: ['editable'],
            summary: 'This batch was prepared against stale state.',
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'stale-revision',
      diagnostics: [
        expect.objectContaining({
          code: 'stale-revision',
          path: 'candidateRevisionId',
          repair: expect.stringContaining('candidate.get_state'),
        }),
      ],
    });
    const state = (await service.dispatch(session.id, 'candidate.get_state', {
      nodeIds: ['editable'],
    })) as {
      candidateRevisionId: string;
      nodes: { items: Array<{ style: { radius: number; padding: number } }> };
      operations: { total: number };
    };
    expect(state.candidateRevisionId).toBe(first.candidateRevisionId);
    expect(state.operations.total).toBe(1);
    expect(state.nodes.items[0].style).toMatchObject({ radius: 8, padding: 12 });
    await service.dispose();
  });

  it('rejects adversarial scope, pinned-descendant, and region mutations', async () => {
    const service = new CanvasSessionService();
    const session = await service.createSession(input(sourceDocument()));
    const apply = (operation: unknown) =>
      service.dispatch(session.id, 'candidate.apply_changes', {
        candidateRevisionId: session.candidateRevisionId,
        changes: [{ operation, evidenceNodeIds: ['group'], summary: 'Attempted unsafe change.' }],
      });
    await expect(
      apply({
        id: 'style-unrelated',
        type: 'style',
        actor: 'agent',
        targetIds: ['unrelated'],
        patch: { fill: '#ffffff' },
      }),
    ).rejects.toMatchObject({ code: 'scope-violation' });
    await expect(
      apply({ id: 'move-group', type: 'move', actor: 'agent', targetIds: ['group'], dx: 1, dy: 1 }),
    ).rejects.toMatchObject({ code: 'pinned-node' });
    await expect(
      apply({
        id: 'resize-editable',
        type: 'resize',
        actor: 'agent',
        targetId: 'editable',
        bounds: { x: 0, y: 0, width: 700, height: 500 },
      }),
    ).rejects.toMatchObject({ code: 'region-violation' });
    await service.dispose();
  });

  it('rejects indirect ancestor and sibling mutations caused by reducer reflow', async () => {
    const document = sourceDocument();
    const service = new CanvasSessionService();
    const narrow = input(document);
    narrow.target.mutationScope.existingNodeIds = ['editable'];
    narrow.target.mutationScope.insertionParentIds = ['group'];
    const session = await service.createSession(narrow);

    await expect(
      service.dispatch(session.id, 'candidate.apply_changes', {
        candidateRevisionId: session.candidateRevisionId,
        changes: [
          {
            operation: {
              id: 'move-with-ancestor-side-effect',
              type: 'move',
              actor: 'agent',
              targetIds: ['editable'],
              dx: 8,
              dy: 0,
            },
            evidenceNodeIds: ['editable'],
            summary: 'Moved the editable child.',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'indirect-scope-violation' });

    const layoutDocument = sourceDocument();
    layoutDocument.nodes.group.layout = {
      mode: 'horizontal',
      gap: 12,
      padding: 8,
      align: 'start',
      justify: 'start',
      widthMode: 'fixed',
      heightMode: 'fixed',
      gridColumns: 2,
    };
    const layoutSession = await service.createSession(input(layoutDocument));
    await expect(
      service.dispatch(layoutSession.id, 'candidate.apply_changes', {
        candidateRevisionId: layoutSession.candidateRevisionId,
        changes: [
          {
            operation: {
              id: 'style-triggering-layout-reflow',
              type: 'style',
              actor: 'agent',
              targetIds: ['group'],
              patch: { radius: 10 },
            },
            evidenceNodeIds: ['group'],
            summary: 'Styled the editable group.',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'indirect-scope-violation' });
    await service.dispose();
  });

  it('allows move operations to mutate the selected subtree but not unrelated nodes', async () => {
    const document = sourceDocument();
    const service = new CanvasSessionService();
    const target = input(document);
    target.pinnedNodeIds = [];
    target.target.mutationScope.existingNodeIds = ['group'];
    const session = await service.createSession(target);

    await expect(
      service.dispatch(session.id, 'candidate.apply_changes', {
        candidateRevisionId: session.candidateRevisionId,
        changes: [
          {
            operation: {
              id: 'move-authorized-subtree',
              type: 'move',
              actor: 'agent',
              targetIds: ['group'],
              dx: 8,
              dy: 0,
            },
            evidenceNodeIds: ['group'],
            summary: 'Moved the selected group and its children.',
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: true });
    const state = (await service.dispatch(session.id, 'candidate.get_state', {
      nodeIds: ['group', 'editable', 'pinned-child'],
    })) as { nodes: { items: DesignNode[] } };
    expect(state.nodes.items.map((node) => node.bounds.x)).toEqual([28, 48, 168]);
    expect(document.nodes.unrelated.bounds.x).toBe(500);
    await service.dispose();
  });

  it('supports dependency-ordered nested creates', async () => {
    const service = new CanvasSessionService();
    const session = await service.createSession(input(sourceDocument()));
    const parent = node(
      'candidate-stack',
      'group',
      { x: 40, y: 180, width: 240, height: 180 },
      'group',
    );
    parent.provenance = { actor: 'agent', operationId: 'create-stack' };
    const child = node(
      'candidate-button',
      'instance',
      { x: 60, y: 210, width: 96, height: 32 },
      'candidate-stack',
    );
    child.componentBinding = { componentId: 'Button', props: { variant: 'default' } };
    child.provenance = { actor: 'agent', operationId: 'create-button' };
    await expect(
      service.dispatch(session.id, 'candidate.apply_changes', {
        candidateRevisionId: session.candidateRevisionId,
        changes: [createChange('orphan-child', child)],
      }),
    ).rejects.toMatchObject({ code: 'insertion-parent-violation' });
    const applied = (await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: session.candidateRevisionId,
      changes: [
        createChange('create-stack', parent),
        createChange('create-button', child, ['create-stack']),
      ],
    })) as { candidateRevisionId: string };
    const state = (await service.dispatch(session.id, 'candidate.get_state', {
      nodeIds: ['candidate-stack', 'candidate-button'],
    })) as { nodes: { items: Array<{ id: string; childIds: string[] }> } };
    expect(state.nodes.items.find((item) => item.id === 'candidate-stack')?.childIds).toEqual([
      'candidate-button',
    ]);
    await expect(
      service.dispatch(session.id, 'candidate.apply_changes', {
        candidateRevisionId: applied.candidateRevisionId,
        changes: [
          {
            operation: {
              id: 'style-button-without-dependency',
              type: 'style',
              actor: 'agent',
              targetIds: ['candidate-button'],
              patch: { radius: 8 },
            },
            evidenceNodeIds: ['group'],
            summary: 'Rounded the generated button.',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'missing-dependency' });
    await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: applied.candidateRevisionId,
      changes: [
        {
          operation: {
            id: 'style-button',
            type: 'style',
            actor: 'agent',
            targetIds: ['candidate-button'],
            patch: { radius: 8 },
          },
          dependencyIds: ['create-button'],
          evidenceNodeIds: ['group'],
          summary: 'Rounded the generated button.',
        },
      ],
    });
    await service.dispose();
  });

  it('provides bounded scene and component discovery', async () => {
    const service = new CanvasSessionService();
    const session = await service.createSession(input(sourceDocument()));
    const overview = (await service.dispatch(session.id, 'scene.overview', { limit: 2 })) as {
      hierarchy: { items: unknown[]; total: number; nextCursor: number };
    };
    expect(overview.hierarchy.items).toHaveLength(2);
    expect(overview.hierarchy).toMatchObject({ total: 5, nextCursor: 2 });
    const search = (await service.dispatch(session.id, 'components.search', {
      query: 'button',
      limit: 3,
    })) as { items: Array<{ id: string }> };
    expect(search.items.some((item) => item.id === 'Button')).toBe(true);
    const description = (await service.dispatch(session.id, 'components.describe', {
      ids: ['Button'],
    })) as { components: Array<{ props: object }> };
    expect(description.components[0].props).toHaveProperty('variant');
    await service.dispose();
  });

  it('validates, freezes, and submits a review candidate with traces', async () => {
    const document = sourceDocument();
    const service = new CanvasSessionService();
    const session = await service.createSession(input(document));
    await expect(service.dispatch(session.id, 'candidate.submit', {})).rejects.toMatchObject({
      code: 'candidate-invalid',
    });
    await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: session.candidateRevisionId,
      changes: [
        {
          operation: {
            id: 'style-editable',
            type: 'style',
            actor: 'agent',
            targetIds: ['editable'],
            patch: { fill: '#ffffff' },
          },
          evidenceNodeIds: ['editable'],
          summary: 'Aligned the selected surface with the frame palette.',
        },
      ],
    });
    const render = (await service.dispatch(session.id, 'scene.render', {
      view: 'candidate',
    })) as { path: string };
    await expect(access(render.path)).resolves.toBeUndefined();
    expect(await service.dispatch(session.id, 'candidate.validate', {})).toMatchObject({
      ok: true,
    });
    const submitted = (await service.dispatch(session.id, 'candidate.submit', {})) as {
      state: string;
      sourceRevisionId: string;
      candidateRevisionId: string;
      candidate: DesignDocument;
      traces: Array<{ tool: string }>;
    };
    expect(submitted.state).toBe('submitted');
    expect(submitted.candidateRevisionId).not.toBe(submitted.sourceRevisionId);
    expect(submitted.candidate.nodes.editable.style.fill).toBe('#ffffff');
    expect(document.nodes.editable.style.fill).toBe('#d9dde3');
    expect(submitted.traces.at(-1)?.tool).toBe('candidate.submit');
    await expect(access(render.path)).rejects.toThrow();
    await expect(service.dispatch(session.id, 'candidate.validate', {})).rejects.toMatchObject({
      code: 'session-not-active',
    });
    await service.dispose();
  });

  it('owns render artifacts and cleans them on cancel', async () => {
    const service = new CanvasSessionService();
    const session = await service.createSession(input(sourceDocument()));
    const first = (await service.dispatch(session.id, 'scene.render', {
      view: 'source',
    })) as { path: string; sha256: string; mimeType: string };
    const second = (await service.dispatch(session.id, 'scene.render', {
      view: 'source',
    })) as { path: string; sha256: string };
    expect(first.mimeType).toBe('image/png');
    expect(second).toMatchObject({ path: first.path, sha256: first.sha256 });
    await expect(access(first.path)).resolves.toBeUndefined();
    expect(await service.cancelSession(session.id)).toBe(true);
    await expect(access(first.path)).rejects.toThrow();
    await expect(service.dispatch(session.id, 'scene.overview', {})).rejects.toBeInstanceOf(
      CanvasSessionError,
    );
    await service.dispose();
  });

  it('renders descendants of an explicitly requested container after candidate mutations', async () => {
    const service = new CanvasSessionService();
    const session = await service.createSession(input(sourceDocument()));
    const source = (await service.dispatch(session.id, 'scene.render', {
      view: 'source',
      nodeIds: ['group'],
    })) as { sha256: string };

    await service.dispatch(session.id, 'candidate.apply_changes', {
      candidateRevisionId: session.candidateRevisionId,
      changes: [
        {
          operation: {
            type: 'create',
            name: 'Visible candidate child',
            kind: 'rectangle',
            parentId: 'group',
            bounds: { x: 70, y: 210, width: 120, height: 50 },
            style: { fill: '#ff0000' },
          },
          evidenceNodeIds: ['group'],
          summary: 'Added a visible child inside the selected group.',
        },
      ],
    });
    const candidate = (await service.dispatch(session.id, 'scene.render', {
      view: 'candidate',
      nodeIds: ['group'],
    })) as { sha256: string };

    expect(candidate.sha256).not.toBe(source.sha256);
    await service.dispose();
  });

  it('cleans expired sessions and their artifacts', async () => {
    let now = 1_000;
    const service = new CanvasSessionService(undefined, () => now);
    const session = await service.createSession(input(sourceDocument(), 1_000));
    const render = (await service.dispatch(session.id, 'scene.render', {})) as { path: string };
    now = 2_001;
    expect(await service.cleanupExpired()).toBe(1);
    await expect(access(render.path)).rejects.toThrow();
    await expect(service.dispatch(session.id, 'candidate.get_state', {})).rejects.toMatchObject({
      code: 'session-not-found',
    });
    await service.dispose();
  });
});
