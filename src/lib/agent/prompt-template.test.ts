import { describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
import type { GenerationRequest } from './candidate';
import {
  CODESIGN_COMPLETE_PROMPT_TEMPLATE,
  CODESIGN_PROMPT_PAYLOAD_TOKEN,
  CODESIGN_PROMPT_TEMPLATE_INSPECTION,
  CODESIGN_SYSTEM_INSTRUCTIONS,
  renderCodesignPrompt,
} from './prompt-template';

function fixture() {
  const document = applyOperation(blankDocument(), {
    id: 'create-region',
    type: 'create',
    actor: 'user',
    node: {
      id: 'region',
      name: 'Region',
      kind: 'rectangle',
      screenId: 'screen-1',
      childIds: [],
      bounds: { x: 10, y: 20, width: 300, height: 220 },
      style: { ...defaultStyle },
      provenance: { actor: 'user', operationId: 'create-region' },
    },
  });
  const request = {
    projectId: 'project-1',
    action: 'complete',
    requestedFidelity: 'wireframe',
    target: {
      focusNodeIds: ['region'],
      observationScope: { kind: 'screen', nodeIds: ['region'] },
      mutationScope: {
        existingNodeIds: ['region'],
        insertionParentIds: [],
        regions: [{ x: 10, y: 20, width: 300, height: 220 }],
        allowCreate: true,
      },
    },
    pinnedNodeIds: [],
    pinnedAtomicChanges: [],
    document: {
      currentRevisionId: document.currentRevisionId,
      activeScreenId: document.activeScreenId,
      screenName: 'Screen 1',
      screenRootIds: ['region'],
      knownNodeIds: ['region'],
      nodes: document.nodes,
      frameFidelity: {},
      nodeFidelityOverrides: {},
    },
  } satisfies GenerationRequest;
  return { request, document };
}

describe('Codesign agent prompt template', () => {
  it('exposes the exact tool-using prompt and submission contract for inspection', () => {
    expect(CODESIGN_COMPLETE_PROMPT_TEMPLATE).toContain(CODESIGN_PROMPT_PAYLOAD_TOKEN);
    expect(CODESIGN_PROMPT_TEMPLATE_INSPECTION.userTemplate).toBe(
      CODESIGN_COMPLETE_PROMPT_TEMPLATE,
    );
    expect(CODESIGN_PROMPT_TEMPLATE_INSPECTION.outputSchema).toContain('candidate.submit');
    expect(CODESIGN_COMPLETE_PROMPT_TEMPLATE).toContain('shadcn-svelte');
    expect(CODESIGN_SYSTEM_INSTRUCTIONS).not.toContain('Never use tools');
  });

  it('renders compact session orientation without dumping nodes or component catalog', () => {
    const { request, document } = fixture();
    const rendered = renderCodesignPrompt(request, {
      id: 'canvas-test',
      state: 'active',
      sourceRevisionId: document.currentRevisionId,
      candidateRevisionId: document.currentRevisionId,
      expiresAt: 100,
    });

    expect(rendered).not.toContain(CODESIGN_PROMPT_PAYLOAD_TOKEN);
    expect(rendered).toContain('"sessionId":"canvas-test"');
    expect(rendered).toContain('"nodeCount":1');
    expect(rendered).toContain('"componentPolicy":"primitive-first:');
    expect(rendered).not.toContain('"nodes"');
    expect(rendered).not.toContain('componentCatalog');
    expect(rendered.length).toBeLessThan(3_000);
  });
});
