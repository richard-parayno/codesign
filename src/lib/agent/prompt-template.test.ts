import { describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
import { buildSceneContext } from './scene-context';
import { createGenerationRun, type GenerationRequest } from './candidate';
import {
  CODESIGN_COMPLETE_PROMPT_TEMPLATE,
  CODESIGN_PROMPT_PAYLOAD_TOKEN,
  CODESIGN_PROMPT_TEMPLATE_INSPECTION,
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
  const context = buildSceneContext({
    snapshot: document,
    focusNodeIds: ['region'],
    observationNodeIds: ['region'],
    observationRootId: null,
    mutationTargetIds: ['region'],
    mutationScope: request.target.mutationScope,
    action: 'complete',
    fidelity: 'wireframe',
    metadata: {
      snapshotId: 'snapshot-1',
      revisionId: document.currentRevisionId,
      capturedAt: 10,
      projectId: 'project-1',
    },
  });
  const run = createGenerationRun(request, {
    runId: 'generation-test',
    createdAt: 10,
    model: 'gpt-test',
    reasoningEffort: 'high',
    contextNodeIds: ['region'],
    contextRootId: undefined,
    contextSummarized: false,
    contextSchemaVersion: context.schemaVersion,
  });
  return { request, context, run };
}

describe('Codesign prompt template', () => {
  it('keeps the explicit dynamic payload boundary visible for inspection', () => {
    expect(CODESIGN_COMPLETE_PROMPT_TEMPLATE).toContain(CODESIGN_PROMPT_PAYLOAD_TOKEN);
    expect(CODESIGN_PROMPT_TEMPLATE_INSPECTION.userTemplate).toBe(
      CODESIGN_COMPLETE_PROMPT_TEMPLATE,
    );
    expect(CODESIGN_PROMPT_TEMPLATE_INSPECTION.outputSchema).toContain('atomicChanges');
  });

  it('renders the exact request prompt from the versioned template', () => {
    const { request, context, run } = fixture();
    const rendered = renderCodesignPrompt(request, run, context);

    expect(rendered).not.toContain(CODESIGN_PROMPT_PAYLOAD_TOKEN);
    expect(rendered).toContain('"idNamespace":"generation-test"');
    expect(rendered).toContain('"scene"');
    expect(rendered.startsWith('Complete the supplied design scene')).toBe(true);
  });
});
