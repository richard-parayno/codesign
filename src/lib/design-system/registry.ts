import { z } from 'zod';
type ComponentContract = {
  id: string;
  name: string;
  importPath: string;
  allowedProps: Record<string, readonly unknown[]>;
  slots: readonly string[];
};
export const componentRegistry: Record<string, ComponentContract> = {
  Card: {
    id: 'Card',
    name: 'Card',
    importPath: '$lib/design-system',
    allowedProps: { density: ['compact', 'comfortable'], radius: ['small', 'medium'] },
    slots: ['default', 'actions'],
  },
  DataRow: {
    id: 'DataRow',
    name: 'Data row',
    importPath: '$lib/design-system',
    allowedProps: { density: ['compact', 'comfortable'], interactive: [true, false] },
    slots: ['default', 'actions'],
  },
  DataTable: {
    id: 'DataTable',
    name: 'Data table',
    importPath: '$lib/design-system',
    allowedProps: { density: ['compact', 'comfortable'] },
    slots: ['default'],
  },
  Sidebar: {
    id: 'Sidebar',
    name: 'Sidebar',
    importPath: '$lib/design-system',
    allowedProps: { collapsed: [true, false] },
    slots: ['default'],
  },
  NavItem: {
    id: 'NavItem',
    name: 'Navigation item',
    importPath: '$lib/design-system',
    allowedProps: { active: [true, false] },
    slots: ['default'],
  },
  Button: {
    id: 'Button',
    name: 'Button',
    importPath: '$lib/design-system',
    allowedProps: { variant: ['primary', 'secondary', 'ghost'], size: ['small', 'medium'] },
    slots: ['default'],
  },
  Input: {
    id: 'Input',
    name: 'Input',
    importPath: '$lib/design-system',
    allowedProps: { size: ['small', 'medium'] },
    slots: [],
  },
  Badge: {
    id: 'Badge',
    name: 'Badge',
    importPath: '$lib/design-system',
    allowedProps: { tone: ['neutral', 'success', 'accent'] },
    slots: ['default'],
  },
  Panel: {
    id: 'Panel',
    name: 'Panel / drawer',
    importPath: '$lib/design-system',
    allowedProps: { side: ['left', 'right'] },
    slots: ['default'],
  },
};
export function validateComponentBinding(componentId: string, props: Record<string, unknown>) {
  const contract = componentRegistry[componentId];
  if (!contract) return { ok: false as const, error: `Unknown component: ${componentId}` };
  for (const [key, value] of Object.entries(props)) {
    const allowed = contract.allowedProps[key];
    if (!allowed) return { ok: false as const, error: `${componentId} does not allow prop ${key}` };
    if (!allowed.some((candidate) => candidate === value))
      return {
        ok: false as const,
        error: `${String(value)} is not valid for ${componentId}.${key}`,
      };
  }
  return { ok: true as const, contract };
}
export const bindingSchema = z
  .object({ componentId: z.string(), props: z.record(z.string(), z.unknown()) })
  .superRefine((binding, ctx) => {
    const result = validateComponentBinding(binding.componentId, binding.props);
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.error });
  });
