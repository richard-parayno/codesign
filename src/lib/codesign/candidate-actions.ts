import type { CandidateRevision } from '$lib/model/types';

export type CandidateActionAvailability = {
  review: boolean;
  reject: boolean;
  reroll: boolean;
};

export function candidateActionAvailability(
  candidate: Pick<CandidateRevision, 'status'> | undefined,
): CandidateActionAvailability {
  const pending = candidate?.status === 'candidate';

  return {
    review: pending,
    reject: pending,
    reroll: Boolean(candidate),
  };
}
