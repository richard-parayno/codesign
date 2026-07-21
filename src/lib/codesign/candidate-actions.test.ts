import { describe, expect, it } from 'vitest';
import { candidateActionAvailability } from './candidate-actions';

describe('candidate action availability', () => {
  it('keeps reroll available after a candidate is accepted', () => {
    expect(candidateActionAvailability({ status: 'accepted' })).toEqual({
      review: false,
      reject: false,
      reroll: true,
    });
  });

  it('keeps reroll available after a candidate is partially accepted', () => {
    expect(candidateActionAvailability({ status: 'partially-accepted' })).toEqual({
      review: false,
      reject: false,
      reroll: true,
    });
  });

  it('offers review, reject, and reroll while a candidate is pending', () => {
    expect(candidateActionAvailability({ status: 'candidate' })).toEqual({
      review: true,
      reject: true,
      reroll: true,
    });
  });

  it('does not offer candidate actions without a generated variation', () => {
    expect(candidateActionAvailability(undefined)).toEqual({
      review: false,
      reject: false,
      reroll: false,
    });
  });
});
