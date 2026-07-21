import type { Fidelity, Representation } from '$lib/model/types';

export type CodesignStage = 'base' | 'wireframe' | 'component';

export function activeCodesignStage(
  representations: Array<Representation | undefined>,
): CodesignStage {
  const lastCodesignRepresentation = representations
    .filter((representation): representation is Representation =>
      Boolean(representation && representation.origin !== 'human'),
    )
    .at(-1);
  return lastCodesignRepresentation
    ? normalizeCodesignFidelity(lastCodesignRepresentation.fidelity)
    : 'base';
}

export function normalizeCodesignFidelity(
  fidelity?: Fidelity,
): Extract<Fidelity, 'wireframe' | 'component'> {
  return fidelity === 'component' || fidelity === 'visual' || fidelity === 'production'
    ? 'component'
    : 'wireframe';
}

export type FidelityStageAction = 'stay-live' | 'inspect-candidate' | 'confirm-generation';

/**
 * Base is UI-only and always means the live canvas. Historical representations are never
 * activated from this control because they contain whole-canvas revision snapshots.
 */
export function fidelityStageAction(stage: CodesignStage, state?: string): FidelityStageAction {
  if (stage === 'base' || state === 'unavailable') return 'stay-live';
  if (state === 'candidate') return 'inspect-candidate';
  return 'confirm-generation';
}
