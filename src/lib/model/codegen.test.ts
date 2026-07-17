import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { generateSvelte } from './codegen';
import { applyOperation } from './operations';
import { blankDocument, defaultStyle, type DesignNode } from './types';

function makeNode(id: string, promoted = false): DesignNode {
  return {
    id,
    name: promoted ? 'Customers' : 'Unresolved region',
    kind: promoted ? 'instance' : 'rectangle',
    screenId: 'screen-1',
    childIds: [],
    bounds: { x: promoted ? 20 : 20, y: promoted ? 20 : 90, width: 300, height: 52 },
    style: { ...defaultStyle },
    componentBinding: promoted
      ? { componentId: 'DataRow', props: { density: 'compact', interactive: true } }
      : undefined,
    provenance: { actor: 'user', operationId: id },
  };
}

describe('Svelte projection', () => {
  it('is stable, mixed-fidelity, and accepted by the Svelte compiler', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-promoted',
      type: 'create',
      actor: 'user',
      node: makeNode('promoted', true),
    });
    document = applyOperation(document, {
      id: 'create-rough',
      type: 'create',
      actor: 'user',
      node: makeNode('rough'),
    });
    const source = generateSvelte(document);
    expect(source).toContain("import { DataRow } from '$lib/design-system'");
    expect(source).toContain('class="greybox"');
    expect(generateSvelte(document)).toBe(source);
    expect(() => compile(source, { generate: false, filename: 'Projection.svelte' })).not.toThrow();
  });
});
