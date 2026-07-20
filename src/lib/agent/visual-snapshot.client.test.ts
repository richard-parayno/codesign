import { describe, expect, it } from 'vitest';
import { applyOperation } from '$lib/model/operations';
import { blankDocument, defaultStyle } from '$lib/model/types';
import { deriveGenerationTarget } from './generation-target';
import { sceneSnapshotSvg } from './visual-snapshot.client';

describe('clean scene snapshot rendering', () => {
  it('contains scene primitives and escaped text without editor overlays or chrome', () => {
    const document = applyOperation(blankDocument(), {
      id: 'create-region',
      type: 'create',
      actor: 'user',
      node: {
        id: 'region',
        name: 'Region',
        kind: 'text',
        screenId: 'screen-1',
        childIds: [],
        bounds: { x: 20, y: 30, width: 200, height: 100 },
        style: { ...defaultStyle },
        text: '<Settings & profile>',
        provenance: { actor: 'user', operationId: 'create-region' },
      },
    });
    const output = sceneSnapshotSvg(document, deriveGenerationTarget(document, ['region']));
    expect(output.svg).toContain('&lt;Settings &amp; profile&gt;');
    expect(output.svg).toContain('<rect');
    expect(output.svg).not.toMatch(/selection|handle|candidate|toolbar|cursor|debug/i);
  });
});
