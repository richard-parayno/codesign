import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CODEX_PROVIDER_DESCRIPTOR,
  CodexCodesignProvider,
  ProviderFailure,
  applyProviderOptions,
  providerRuntimeStatus,
  providerSettings,
} from './index';
import type { CodexAppServer } from '../codex-client.server';

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

  it('uses the user-installed Codex command with the initial model and effort', () => {
    expect(providerSettings({})).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'high',
      command: 'codex',
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
    expect(providerRuntimeStatus(configured, { PATH: '/definitely/missing' })).toMatchObject({
      detected: false,
      source: 'path',
      label: 'codex on PATH',
    });
  });

  it('resolves a bare Codex executable from PATH without consulting node_modules', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codesign-codex-path-'));
    const command = join(directory, 'codex');
    try {
      writeFileSync(command, '#!/bin/sh\nexit 0\n');
      chmodSync(command, 0o755);

      expect(providerRuntimeStatus(providerSettings({}), { PATH: directory })).toEqual({
        detected: true,
        source: 'path',
        label: command,
      });
      expect(providerSettings({}).command).toBe('codex');
      expect(providerSettings({}).command).not.toContain('node_modules');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves and detects an absolute executable override whose path contains spaces', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codesign codex override '));
    const command = join(directory, 'codex executable');
    try {
      writeFileSync(command, '#!/bin/sh\nexit 0\n');
      chmodSync(command, 0o755);
      const settings = providerSettings({ CODESIGN_CODEX_COMMAND: command });

      expect(settings.command).toBe(command);
      expect(providerRuntimeStatus(settings, {})).toEqual({
        detected: true,
        source: 'command-override',
        label: command,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects the Codex command through PATHEXT on Windows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codesign-codex-windows-'));
    const command = join(directory, 'codex.cmd');
    try {
      writeFileSync(command, '@echo off\r\nexit /b 0\r\n');

      expect(
        providerRuntimeStatus(
          providerSettings({}),
          { PATH: directory, PATHEXT: '.EXE;.CMD' },
          'win32',
        ),
      ).toEqual({
        detected: true,
        source: 'path',
        label: command,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns actionable status when the user-installed runtime is missing', async () => {
    const client = {
      readAccount: vi.fn().mockRejectedValue(
        Object.assign(new Error('spawn codex ENOENT'), {
          code: 'ENOENT',
        }),
      ),
    } as unknown as CodexAppServer;
    const provider = new CodexCodesignProvider(client, 'gpt-5.6-luna', 'high');

    await expect(provider.status()).resolves.toMatchObject({
      available: false,
      connected: false,
      failureCategory: 'unavailable',
      message: 'Codex CLI is unavailable. Install it separately, then run pnpm run doctor.',
    });
  });

  it('directs unauthenticated users to verify setup without reading credentials', async () => {
    const client = {
      readAccount: vi.fn().mockResolvedValue({
        connected: false,
        requiresOpenaiAuth: true,
        authMode: null,
        planType: null,
        accountLabel: null,
      }),
    } as unknown as CodexAppServer;
    const provider = new CodexCodesignProvider(client, 'gpt-5.6-luna', 'high');

    await expect(provider.status()).resolves.toMatchObject({
      available: true,
      connected: false,
      failureCategory: 'missing-login',
      message: 'Sign in to Codex with ChatGPT, then run pnpm run doctor to verify AI setup.',
    });
    expect(client.readAccount).toHaveBeenCalledOnce();
  });
});
