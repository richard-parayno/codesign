import {
  componentCatalog,
  resolveComponent,
  type CodesignComponentDefinition,
  type ComponentCategory,
} from '$lib/design-system/manifest';
import { CanvasSessionError } from './contracts';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;

export type ComponentSearchInput = {
  query?: string;
  category?: ComponentCategory;
  slots?: string[];
  capabilities?: Array<'editable-content' | 'interactive' | 'compound' | 'children'>;
  cursor?: number;
  limit?: number;
};

function hasCapability(
  component: CodesignComponentDefinition,
  capability: NonNullable<ComponentSearchInput['capabilities']>[number],
) {
  if (capability === 'editable-content')
    return component.editableContent || component.parts.some((part) => part.editableContent);
  if (capability === 'interactive') return component.interaction.preview === 'enabled';
  if (capability === 'compound') return component.parts.length > 0;
  return component.slots.some((slot) => slot.accepts.length > 0);
}

export function searchComponents(input: ComponentSearchInput) {
  const query = input.query?.trim().toLocaleLowerCase() ?? '';
  const cursor = Math.max(0, Math.trunc(input.cursor ?? 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIMIT)));
  const matches = componentCatalog.filter((component) => {
    if (input.category && component.category !== input.category) return false;
    if (
      query &&
      ![component.id, component.displayName, component.description, component.category]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    if (
      input.slots?.length &&
      !input.slots.every((id) => component.slots.some((slot) => slot.id === id))
    )
      return false;
    return (input.capabilities ?? []).every((capability) => hasCapability(component, capability));
  });
  const items = matches.slice(cursor, cursor + limit).map((component) => ({
    id: component.id,
    source: 'shadcn-svelte' as const,
    displayName: component.displayName,
    category: component.category,
    description: component.description,
    defaultSize: component.defaultSize,
    capabilities: {
      editableContent:
        component.editableContent || component.parts.some((part) => part.editableContent),
      interactive: component.interaction.preview === 'enabled',
      compound: component.parts.length > 0,
      children: component.slots.some((slot) => slot.accepts.length > 0),
    },
  }));
  return {
    items,
    total: matches.length,
    nextCursor: cursor + items.length < matches.length ? cursor + items.length : null,
  };
}

export function describeComponents(ids: string[]) {
  if (!ids.length)
    throw new CanvasSessionError('invalid-arguments', 'At least one component ID is required');
  if (ids.length > 12)
    throw new CanvasSessionError('result-too-large', 'Describe at most 12 components per request');
  const components = ids.map((id) => {
    const resolved = resolveComponent(id);
    if (!resolved) throw new CanvasSessionError('component-not-found', `Unknown component: ${id}`);
    const { root, part } = resolved;
    return {
      id,
      source: 'shadcn-svelte' as const,
      rootId: root.id,
      displayName: part?.displayName ?? root.displayName,
      description: root.description,
      category: root.category,
      props: part ? {} : root.props,
      slots: part?.slots ?? root.slots,
      parts: part ? [] : root.parts,
      defaults: part
        ? { content: '', props: {} }
        : {
            content: root.defaultContent,
            props: Object.fromEntries(
              Object.entries(root.props).flatMap(([key, definition]) =>
                definition.default === undefined ? [] : [[key, definition.default]],
              ),
            ),
            size: root.defaultSize,
          },
      editable: { content: part?.editableContent ?? root.editableContent, props: !part },
      codegen: root.codegen,
    };
  });
  return { components };
}
