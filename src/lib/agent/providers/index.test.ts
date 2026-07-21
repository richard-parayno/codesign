import { describe, expect, it } from 'vitest';
import {
  CODEX_PROVIDER_DESCRIPTOR,
  ProviderFailure,
  applyProviderOptions,
  providerRuntimeStatus,
  providerSettings,
} from './index';
import { pinnedCodexCommand } from '../codex-client.server';

describe('Codesign provider boundary', () => {
  it('advertises provider-specific visual and authentication capabilities', () => {
    expect(CODEX_PROVIDER_DESCRIPTOR.capabilities).toMatchObject({
      agentSessions: true,
      dynamicTools: true,
      structuredCandidates: false,
      visualInputs: ['image', 'localImage'],
      authentication: 'app-server-chatgpt',
      canStartLogin: true,
      canLogout: true,
    });
  });

  it('pins the initial Codex model, effort, and project-local runtime', () => {
    expect(providerSettings({})).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'high',
      command: pinnedCodexCommand(),
    });
  });

  it('accepts explicit advanced overrides and rejects invalid effort configuration', () => {
    expect(
      providerSettings({
        CODESIGN_CODEX_COMMAND: '/opt/codex-experimental',
        CODESIGN_CODEX_MODEL: 'model-preview',
        CODESIGN_CODEX_EFFORT: 'xhigh',
      }),
    ).toEqual({
      model: 'model-preview',
      effort: 'xhigh',
      command: '/opt/codex-experimental',
    });
    expect(() => providerSettings({ CODESIGN_CODEX_EFFORT: 'maximum' })).toThrow(ProviderFailure);
  });

  it('applies bounded per-generation model choices without changing runtime ownership', () => {
    const configured = providerSettings({});
    expect(
      applyProviderOptions(configured, { model: 'gpt-5.6-luna-fast', effort: 'medium' }),
    ).toEqual({
      ...configured,
      model: 'gpt-5.6-luna-fast',
      effort: 'medium',
    });
    expect(() => applyProviderOptions(configured, { model: '../unsafe model' })).toThrow(
      ProviderFailure,
    );
    expect(providerRuntimeStatus(configured)).toMatchObject({
      source: 'project-pinned',
      label: '@openai/codex project runtime',
    });
  });
});
