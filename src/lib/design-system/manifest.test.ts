import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adaptComponentProps,
  componentCatalog,
  componentIdSchema,
  componentIds,
  componentManifest,
  componentPartIds,
  getDefaultComponentBlueprint,
  loadComponent,
  resolveComponent,
  validateComponentBinding,
  validateComponentChild,
} from './manifest';

const uiDirectory = fileURLToPath(new URL('../components/ui', import.meta.url));

describe('Codesign component manifest', () => {
  it('covers every installed shadcn-svelte component directory exactly once', () => {
    const installedDirectories = readdirSync(uiDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const manifestDirectories = componentCatalog.map((entry) => entry.directory).sort();

    expect(installedDirectories).toHaveLength(56);
    expect(manifestDirectories).toEqual(installedDirectories);
    expect(new Set(componentCatalog.map((entry) => entry.id)).size).toBe(componentCatalog.length);
  });

  it('points every root and part at a checked-in source export', () => {
    for (const component of componentCatalog) {
      const source = readFileSync(`${uiDirectory}/${component.directory}/index.ts`, 'utf8');
      expect(source, `${component.id} root export`).toContain(component.exportName);
      expect(component.importPath).toBe(`$lib/components/ui/${component.directory}`);
      expect(component.load).toBeTypeOf('function');
      for (const part of component.parts) {
        expect(source, `${part.id} part export`).toContain(part.exportName);
        expect(resolveComponent(part.id)?.root.id).toBe(component.id);
      }
    }
  });

  it('loads every checked-in root and part export', async () => {
    await Promise.all(componentIds.map((id) => expect(loadComponent(id)).resolves.toBeTruthy()));
  }, 15_000);

  it('derives IDs, schemas, and editable blueprints from the canonical catalog', () => {
    expect(Object.keys(componentManifest)).toHaveLength(56);
    expect(componentIds).toHaveLength(56 + componentPartIds.length);
    expect(new Set(componentIds).size).toBe(componentIds.length);
    expect(componentIdSchema.parse('Card.Header')).toBe('Card.Header');
    expect(componentIdSchema.safeParse('MadeUpWidget').success).toBe(false);

    const card = getDefaultComponentBlueprint('Card');
    expect(card?.[0]).toMatchObject({ componentId: 'Card', key: 'root' });
    expect(card?.some((node) => node.componentId === 'Card.Title')).toBe(true);
    expect(card).not.toBe(getDefaultComponentBlueprint('Card'));
  });

  it('validates finite props and rejects undeclared or incorrectly typed props', () => {
    expect(validateComponentBinding('Button', { variant: 'outline', disabled: true }).ok).toBe(
      true,
    );
    expect(validateComponentBinding('Button', { variant: 'neon' }).ok).toBe(false);
    expect(validateComponentBinding('Progress', { value: 'half' }).ok).toBe(false);
    expect(validateComponentBinding('Card.Title', { variant: 'outline' }).ok).toBe(false);
    expect(validateComponentBinding('Unknown', {}).ok).toBe(false);
  });

  it('adapts semantic editor props to valid shadcn renderer props', () => {
    expect(adaptComponentProps('Button', { variant: 'primary', size: 'medium' })).toEqual({
      variant: 'default',
      size: 'default',
    });
    expect(adaptComponentProps('Card', { density: 'compact', radius: 'small' })).toEqual({
      size: 'sm',
      class: 'rounded-md',
    });
    expect(adaptComponentProps('Tabs.Trigger', {})).toEqual({ value: 'overview' });
    expect(adaptComponentProps('Select.Item', {})).toEqual({
      value: 'option-one',
      label: 'Option one',
    });
    expect(adaptComponentProps('Sheet', { open: false, side: 'left' })).toEqual({
      open: false,
    });
    expect(adaptComponentProps('Sheet.Content', {}, { side: 'left' })).toEqual({ side: 'left' });
  });

  it('declares honest canvas render strategies for native, composed, and headless entries', () => {
    expect(componentManifest.Button.renderStrategy).toBe('native');
    for (const id of [
      'Card',
      'Tabs',
      'Dialog',
      'Sheet',
      'Select',
      'DropdownMenu',
      'NavigationMenu',
    ]) {
      expect(componentManifest[id].renderStrategy, id).toBe('compound');
    }
    expect(componentManifest.Sidebar.renderStrategy).toBe('fallback');
    expect(componentManifest.DataTable.renderStrategy).toBe('fallback');
  });

  it('provides valid nested blueprints for representative interactive compounds', () => {
    const expectedParts = {
      Tabs: ['Tabs.List', 'Tabs.Trigger', 'Tabs.Content'],
      Dialog: ['Dialog.Trigger', 'Dialog.Content', 'Dialog.Header', 'Dialog.Title'],
      Sheet: ['Sheet.Trigger', 'Sheet.Content', 'Sheet.Header', 'Sheet.Title'],
      Select: ['Select.Trigger', 'Select.Content', 'Select.Group', 'Select.Item'],
      DropdownMenu: ['DropdownMenu.Trigger', 'DropdownMenu.Content', 'DropdownMenu.Item'],
      NavigationMenu: [
        'NavigationMenu.List',
        'NavigationMenu.Item',
        'NavigationMenu.Trigger',
        'NavigationMenu.Content',
        'NavigationMenu.Link',
      ],
    } as const;

    for (const [rootId, partIds] of Object.entries(expectedParts)) {
      const ids = getDefaultComponentBlueprint(rootId)?.map((node) => node.componentId) ?? [];
      for (const partId of partIds) expect(ids, `${rootId}:${partId}`).toContain(partId);
    }
  });

  it('enforces component slots without allowing unrelated or leaf children', () => {
    expect(validateComponentChild('Card', 'Card.Header').ok).toBe(true);
    expect(validateComponentChild('Card.Header', 'Card.Title').ok).toBe(true);
    expect(validateComponentChild('Card.Content', 'Button').ok).toBe(true);
    expect(validateComponentChild('Card.Title', 'Card.Description').ok).toBe(false);
    expect(validateComponentChild('Card', 'Button').ok).toBe(false);
    expect(validateComponentChild('Button', 'Card').ok).toBe(false);
    expect(validateComponentChild('Card', 'Card.Header', 'actions').ok).toBe(false);
  });

  it('gives every compound component a dependency-ordered default composition', () => {
    for (const component of componentCatalog.filter((entry) => entry.parts.length > 0)) {
      expect(component.defaultComposition.length, component.id).toBeGreaterThan(1);
      const keys = new Set<string>();
      const componentsByKey = new Map<string, string>();
      for (const node of component.defaultComposition) {
        if (node.parentKey) {
          expect(keys.has(node.parentKey), `${component.id}:${node.key}`).toBe(true);
          expect(
            validateComponentChild(
              componentsByKey.get(node.parentKey)!,
              node.componentId,
              node.slot,
            ).ok,
            `${component.id}:${node.parentKey}->${node.key}`,
          ).toBe(true);
        }
        expect(componentIds).toContain(node.componentId);
        keys.add(node.key);
        componentsByKey.set(node.key, node.componentId);
      }
    }
  });
});
