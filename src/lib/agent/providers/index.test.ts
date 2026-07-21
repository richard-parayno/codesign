import { describe, expect, it } from 'vitest';
import {
  CODEX_PROVIDER_DESCRIPTOR,
  LOCAL_PROVIDER_DESCRIPTOR,
  ProviderFailure,
  applyProviderOptions,
  providerRuntimeStatus,
  providerSettings,
} from './index';
import { pinnedCodexCommand } from '../codex-client.server';

describe('Codesign provider boundary', () => {
  it('advertises provider-specific visual and authentication capabilities', () => {
    expect(LOCAL_PROVIDER_DESCRIPTOR.capabilities).toMatchObject({
      visualInputs: [],
      authentication: 'none',
      canStartLogin: false,
      canLogout: false,
    });
    expect(CODEX_PROVIDER_DESCRIPTOR.capabilities).toMatchObject({
      visualInputs: ['image', 'localImage'],
      authentication: 'app-server-chatgpt',
      canStartLogin: true,
      canLogout: true,
    });
  });

  it('pins the initial Codex model, effort, and project-local runtime', () => {
    expect(providerSettings({ CODESIGN_AGENT_BACKEND: 'codex' })).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      effort: 'high',
      command: pinnedCodexCommand(),
    });
  });

  it('accepts explicit advanced overrides and rejects invalid provider configuration', () => {
    expect(
      providerSettings({
        CODESIGN_AGENT_BACKEND: 'codex',
        CODESIGN_CODEX_COMMAND: '/opt/codex-experimental',
        CODESIGN_CODEX_MODEL: 'model-preview',
        CODESIGN_CODEX_EFFORT: 'xhigh',
      }),
    ).toEqual({
      provider: 'codex',
      model: 'model-preview',
      effort: 'xhigh',
      command: '/opt/codex-experimental',
    });
    expect(() => providerSettings({ CODESIGN_AGENT_BACKEND: 'shared-cloud-service' })).toThrow(
      ProviderFailure,
    );
    expect(() =>
      providerSettings({ CODESIGN_AGENT_BACKEND: 'codex', CODESIGN_CODEX_EFFORT: 'maximum' }),
    ).toThrow(ProviderFailure);
  });

  it('applies bounded per-generation model choices without changing runtime ownership', () => {
    const configured = providerSettings({ CODESIGN_AGENT_BACKEND: 'codex' });
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
