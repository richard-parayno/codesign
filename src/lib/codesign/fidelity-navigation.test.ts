import { describe, expect, it } from 'vitest';
import { normalizeCodesignFidelity, shouldNavigateSavedFidelity } from './fidelity-navigation';

describe('fidelity slider navigation', () => {
  it('does not replace the live canvas with a historical representation of the same fidelity', () => {
    expect(
      shouldNavigateSavedFidelity(
        {
          fidelity: 'wireframe',
          state: 'versions',
          representationId: 'representation-revision-22',
        },
        'wireframe',
      ),
    ).toBe(false);
  });

  it('allows explicit navigation to a saved representation at another fidelity', () => {
    expect(
      shouldNavigateSavedFidelity(
        {
          fidelity: 'component',
          state: 'saved',
          representationId: 'representation-component',
        },
        'wireframe',
      ),
    ).toBe(true);
  });

  it('normalizes legacy higher fidelities to Component', () => {
    expect(normalizeCodesignFidelity('production')).toBe('component');
  });
});
