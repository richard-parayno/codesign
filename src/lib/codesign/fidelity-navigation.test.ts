import { describe, expect, it } from 'vitest';
import { fidelityStageAction, normalizeCodesignFidelity } from './fidelity-navigation';

describe('fidelity slider navigation', () => {
  it('normalizes legacy higher fidelities to Component', () => {
    expect(normalizeCodesignFidelity('production')).toBe('component');
  });

  it('keeps Base on the live canvas instead of navigating revision history', () => {
    expect(fidelityStageAction('base', 'saved')).toBe('stay-live');
  });

  it('requires confirmation before generating either AI stage', () => {
    expect(fidelityStageAction('wireframe', 'generate')).toBe('confirm-generation');
    expect(fidelityStageAction('component', 'generate')).toBe('confirm-generation');
  });

  it('regenerates a historical AI stage from the live canvas instead of restoring its revision', () => {
    expect(fidelityStageAction('wireframe', 'saved')).toBe('confirm-generation');
    expect(fidelityStageAction('component', 'versions')).toBe('confirm-generation');
  });

  it('opens an active candidate without starting another generation', () => {
    expect(fidelityStageAction('component', 'candidate')).toBe('inspect-candidate');
  });
});
