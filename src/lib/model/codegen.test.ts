import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { generateSvelte } from './codegen';
import { applyOperation } from './operations';
import { blankDocument, defaultStyle, type DesignNode } from './types';

function makeNode(
  id: string,
  componentId?: string,
  parentId?: string,
  props?: Record<string, unknown>,
): DesignNode {
  return {
    id,
    name: componentId ? componentId.replace('.', ' ') : 'Unresolved region',
    kind: componentId ? 'instance' : 'rectangle',
    screenId: 'screen-1',
    parentId,
    childIds: [],
    bounds: { x: 20, y: componentId ? 20 : 90, width: 300, height: 52 },
    style: { ...defaultStyle },
    componentBinding: componentId
      ? {
          componentId,
          props: props ?? (componentId === 'Card' ? { density: 'compact', radius: 'small' } : {}),
          slot: parentId ? 'default' : undefined,
        }
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
      node: makeNode('card', 'Card'),
    });
    document = applyOperation(document, {
      id: 'create-card-header',
      type: 'create',
      actor: 'user',
      node: makeNode('card-header', 'Card.Header', 'card'),
    });
    document = applyOperation(document, {
      id: 'create-card-title',
      type: 'create',
      actor: 'user',
      node: makeNode('card-title', 'Card.Title', 'card-header'),
    });
    document = applyOperation(document, {
      id: 'create-rough',
      type: 'create',
      actor: 'user',
      node: makeNode('rough'),
    });
    const source = generateSvelte(document);
    expect(source).toContain("import * as Card from '$lib/components/ui/card';");
    expect(source).toContain('<Card.Root class={"rounded-md"} size={"sm"}>');
    expect(source).toContain('<Card.Title>');
    expect(source).toContain('class="greybox"');
    expect(generateSvelte(document)).toBe(source);
    expect(() => compile(source, { generate: false, filename: 'Projection.svelte' })).not.toThrow();
  });

  it('routes compound root props to the shadcn part that owns them', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-sheet',
      type: 'create',
      actor: 'user',
      node: makeNode('sheet', 'Sheet', undefined, { open: false, side: 'left' }),
    });
    document = applyOperation(document, {
      id: 'create-sheet-content',
      type: 'create',
      actor: 'user',
      node: makeNode('sheet-content', 'Sheet.Content', 'sheet'),
    });

    const source = generateSvelte(document);
    expect(source).toContain("import * as Sheet from '$lib/components/ui/sheet';");
    expect(source).toContain('<Sheet.Root open={false}>');
    expect(source).toContain('<Sheet.Content side={"left"}>');
    expect(() => compile(source, { generate: false, filename: 'Projection.svelte' })).not.toThrow();
  });

  it('projects canonical horizontal and grid layout as valid Svelte styles', () => {
    let document = applyOperation(blankDocument(), {
      id: 'create-layout-frame',
      type: 'create',
      actor: 'user',
      node: {
        ...makeNode('layout-frame'),
        kind: 'frame',
        layout: {
          mode: 'grid',
          gap: 12,
          padding: { top: 8, right: 16, bottom: 8, left: 16 },
          align: 'stretch',
          justify: 'space-between',
          widthMode: 'fill',
          heightMode: 'hug',
          gridColumns: 3,
        },
      },
    });
    document = applyOperation(document, {
      id: 'create-layout-child',
      type: 'create',
      actor: 'user',
      node: { ...makeNode('layout-child'), parentId: 'layout-frame' },
    });

    const source = generateSvelte(document);
    expect(source).toContain('display:grid');
    expect(source).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');
    expect(source).toContain('padding:8px 16px 8px 16px');
    expect(source).toContain('width:100%');
    expect(source).toContain('height:fit-content');
    expect(() => compile(source, { generate: false, filename: 'Projection.svelte' })).not.toThrow();
  });
});
