import type { Fidelity } from '$lib/model/types';

type SavedFidelityStop = {
  fidelity: Fidelity;
  state: string;
  representationId?: string;
};

export function normalizeCodesignFidelity(
  fidelity?: Fidelity,
): Extract<Fidelity, 'wireframe' | 'component'> {
  return fidelity === 'component' || fidelity === 'visual' || fidelity === 'production'
    ? 'component'
    : 'wireframe';
}

/** A slider move must never replace the live canvas with an older revision of the same fidelity. */
export function shouldNavigateSavedFidelity(stop: SavedFidelityStop, committedFidelity?: Fidelity) {
  return Boolean(
    stop.representationId &&
    (stop.state === 'saved' || stop.state === 'versions') &&
    normalizeCodesignFidelity(stop.fidelity) !== normalizeCodesignFidelity(committedFidelity),
  );
}
