import { describe, expect, it } from 'vitest';
import { CanvasSessionError } from './contracts';
import { describeComponents, searchComponents } from './component-tools';

describe('component harness tools', () => {
  it('searches the canonical manifest with bounded pagination', () => {
    const first = searchComponents({ category: 'forms', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBeGreaterThan(2);
    expect(first.nextCursor).toBe(2);
    const compound = searchComponents({ query: 'card', capabilities: ['compound'] });
    expect(compound.items.some((item) => item.id === 'Card')).toBe(true);
  });

  it('describes only requested canonical contracts', () => {
    const result = describeComponents(['Button', 'Card']);
    expect(result.components.map((component) => component.id)).toEqual(['Button', 'Card']);
    expect(result.components[0].props).toHaveProperty('variant');
    expect(result.components[1].parts.some((part) => part.id === 'Card.Title')).toBe(true);
    expect(() => describeComponents(['NotAComponent'])).toThrow(CanvasSessionError);
  });
});
