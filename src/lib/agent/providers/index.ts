import { constants, accessSync } from 'node:fs';
import { delimiter, isAbsolute } from 'node:path';
import type { ReasoningEffort } from '../../../../.generated/codex-app-server/ReasoningEffort';
import {
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  getCodexClient,
  pinnedCodexCommand,
  resolveCodexCommand,
  type CodexAppServer,
  type CodexLoginStart,
} from '../codex-client.server';
import { agentCandidateBatchSchema } from '../candidate';
import {
  ProviderFailure,
  asProviderFailure,
  type CodesignProvider,
  type ProviderDescriptor,
  type ProviderGenerationInput,
  type ProviderId,
  type ProviderModelOption,
  type ProviderStatus,
} from './contracts';

export * from './contracts';

export const CODEX_PROVIDER_DESCRIPTOR = {
  id: 'codex',
  label: 'Codex App Server',
  capabilities: {
    agentSessions: true,
    dynamicTools: true,
    structuredCandidates: false,
    supportedActions: ['complete'],
    visualInputs: ['image', 'localImage'],
    authentication: 'app-server-chatgpt',
    canStartLogin: true,
    canLogout: true,
    cancellation: true,
  },
} as const satisfies ProviderDescriptor;

const validEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export type ProviderSettings = {
  model: string;
  effort: ReasoningEffort;
  command: string;
};

export type ProviderOptions = {
  model?: string;
  effort?: ReasoningEffort;
};

const validModelName = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

export function applyProviderOptions(
  settings: ProviderSettings,
  options: ProviderOptions | undefined,
): ProviderSettings {
  if (!options) return settings;
  const model = options.model?.trim() || settings.model;
  const effort = options.effort ?? settings.effort;
  if (!validModelName.test(model) || !validEfforts.has(effort))
    throw new ProviderFailure('protocol-failure');
  return { ...settings, model, effort };
}

function executableExists(command: string, environment: NodeJS.ProcessEnv) {
  const candidates =
    isAbsolute(command) || command.includes('/')
      ? [command]
      : (environment.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((directory) => `${directory}/${command}`);
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function providerRuntimeStatus(
  settings: ProviderSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const projectPinned = settings.command === pinnedCodexCommand();
  return {
    detected: executableExists(settings.command, environment),
    source: projectPinned ? ('project-pinned' as const) : ('advanced-override' as const),
    label: projectPinned ? '@openai/codex project runtime' : 'Advanced command override',
  };
}

/** Reads only process configuration; Codex authentication remains entirely App Server-owned. */
export function providerSettings(environment: NodeJS.ProcessEnv = process.env): ProviderSettings {
  const model = environment.CODESIGN_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
  const effort =
    (environment.CODESIGN_CODEX_EFFORT ?? DEFAULT_CODEX_EFFORT).trim().toLowerCase() ||
    DEFAULT_CODEX_EFFORT;
  if (!validEfforts.has(effort)) throw new ProviderFailure('protocol-failure');
  return {
    model,
    effort,
    command: resolveCodexCommand(environment.CODESIGN_CODEX_COMMAND),
  };
}

function parseCandidate(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return agentCandidateBatchSchema.parse(JSON.parse(trimmed) as unknown);
}

export class CodexCodesignProvider implements CodesignProvider {
  readonly descriptor = CODEX_PROVIDER_DESCRIPTOR;

  constructor(
    private client: CodexAppServer,
    readonly model: string,
    readonly effort: ReasoningEffort,
  ) {}

  async status(): Promise<ProviderStatus> {
    try {
      const account = await this.client.readAccount();
      return {
        provider: 'codex',
        available: true,
        connected: account.connected,
        authMode: account.authMode,
        planType: account.planType,
        accountLabel: account.accountLabel,
        ...(!account.connected ? { failureCategory: 'missing-login' as const } : {}),
        message: account.connected
          ? 'Codex App Server is connected.'
          : 'Sign in to Codex with ChatGPT to enable AI generation.',
      };
    } catch (cause) {
      const failure = asProviderFailure(cause);
      return {
        provider: 'codex',
        available: false,
        connected: false,
        authMode: null,
        planType: null,
        accountLabel: null,
        failureCategory: failure.category,
        message: failure.message,
      };
    }
  }

  async startLogin(): Promise<CodexLoginStart> {
    try {
      return await this.client.startChatgptLogin();
    } catch (cause) {
      throw asProviderFailure(cause);
    }
  }

  async models(): Promise<ProviderModelOption[]> {
    try {
      return await this.client.listModels();
    } catch (cause) {
      throw asProviderFailure(cause);
    }
  }

  async logout() {
    try {
      await this.client.logout();
    } catch (cause) {
      throw asProviderFailure(cause);
    }
  }

  async generate(input: ProviderGenerationInput) {
    if (!input.prompt) throw new ProviderFailure('protocol-failure');
    let text: string;
    try {
      text = await this.client.proposeCandidate(input.prompt, input.signal, input.visualInput, {
        model: input.model ?? this.model,
        effort: input.effort ?? this.effort,
        onTelemetry: input.onTelemetry,
      });
    } catch (cause) {
      throw asProviderFailure(cause, 'generation');
    }
    try {
      return parseCandidate(text);
    } catch (cause) {
      throw asProviderFailure(cause, 'output-validation');
    }
  }
}

export function createProvider(settings = providerSettings()): CodesignProvider {
  return new CodexCodesignProvider(
    getCodexClient(settings.command, settings.model, settings.effort),
    settings.model,
    settings.effort,
  );
}

export function configuredCodexProvider(settings = providerSettings()) {
  return createProvider(settings) as CodexCodesignProvider;
}
