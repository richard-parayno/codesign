import { describe, expect, it } from 'vitest';
import type { Representation } from '$lib/model/types';
import {
  activeCodesignStage,
  fidelityStageAction,
  normalizeCodesignFidelity,
} from './fidelity-navigation';

function representation(
  id: string,
  fidelity: Representation['fidelity'],
  origin: Representation['origin'],
): Representation {
  return {
    id,
    entityId: 'entity-selection',
    fidelity,
    origin,
    revisionId: `revision-${id}`,
    rootNodeIds: ['selection'],
  };
}

describe('fidelity slider navigation', () => {
  it('normalizes legacy higher fidelities to Component', () => {
    expect(normalizeCodesignFidelity('production')).toBe('component');
  });

  it('keeps Base on the live canvas instead of navigating revision history', () => {
    expect(fidelityStageAction('base', 'saved')).toBe('stay-live');
  });

  it('treats an element with only human edits as Base', () => {
    expect(activeCodesignStage([representation('human', 'wireframe', 'human')])).toBe('base');
  });

  it('keeps the last applied Codesign fidelity after later human edits', () => {
    expect(
      activeCodesignStage([
        representation('draft', 'wireframe', 'mixed'),
        representation('rename', 'wireframe', 'human'),
      ]),
    ).toBe('wireframe');
  });

  it('uses the most recently applied Codesign fidelity', () => {
    expect(
      activeCodesignStage([
        representation('draft', 'wireframe', 'mixed'),
        representation('hifi', 'component', 'mixed'),
      ]),
    ).toBe('component');
  });

  it('requires confirmation before generating either AI stage', () => {
    expect(fidelityStageAction('wireframe', 'generate')).toBe('confirm-generation');
    expect(fidelityStageAction('component', 'generate')).toBe('confirm-generation');
  });

  it('does not mistake raw primitives for an already-executed AI Draft', () => {
    expect(fidelityStageAction('wireframe', 'current')).toBe('confirm-generation');
  });

  it('regenerates a historical AI stage from the live canvas instead of restoring its revision', () => {
    expect(fidelityStageAction('wireframe', 'saved')).toBe('confirm-generation');
    expect(fidelityStageAction('component', 'versions')).toBe('confirm-generation');
  });

  it('opens an active candidate without starting another generation', () => {
    expect(fidelityStageAction('component', 'candidate')).toBe('inspect-candidate');
  });
});
