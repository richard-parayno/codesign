import type { ReasoningEffort } from '../../../../.generated/codex-app-server/ReasoningEffort';
import {
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  getCodexClient,
  resolveCodexCommand,
  type CodexAppServer,
  type CodexLoginStart,
} from '../codex-client.server';
import { agentCandidateBatchSchema } from '../candidate';
import { localCandidateBatch } from '../local';
import {
  ProviderFailure,
  asProviderFailure,
  type CodesignProvider,
  type ProviderDescriptor,
  type ProviderGenerationInput,
  type ProviderId,
  type ProviderStatus,
} from './contracts';

export * from './contracts';

export const LOCAL_PROVIDER_DESCRIPTOR = {
  id: 'local',
  label: 'Deterministic local',
  capabilities: {
    structuredCandidates: true,
    supportedActions: ['complete'],
    visualInputs: [],
    authentication: 'none',
    canStartLogin: false,
    canLogout: false,
    cancellation: false,
  },
} as const satisfies ProviderDescriptor;

export const CODEX_PROVIDER_DESCRIPTOR = {
  id: 'codex',
  label: 'Codex App Server',
  capabilities: {
    structuredCandidates: true,
    supportedActions: ['complete'],
    visualInputs: ['image', 'localImage'],
    authentication: 'app-server-chatgpt',
    canStartLogin: true,
    canLogout: true,
    cancellation: true,
  },
} as const satisfies ProviderDescriptor;

const validEfforts = new Set(['low', 'medium', 'high', 'xhigh']);

export type ProviderSettings = {
  provider: ProviderId;
  model: string;
  effort: ReasoningEffort;
  command: string;
};

/** Reads only process configuration; Codex authentication remains entirely App Server-owned. */
export function providerSettings(environment: NodeJS.ProcessEnv = process.env): ProviderSettings {
  const configuredProvider =
    environment.CODESIGN_AGENT_BACKEND ?? environment.MALLEABLE_AGENT_BACKEND ?? 'local';
  if (configuredProvider !== 'local' && configuredProvider !== 'codex')
    throw new ProviderFailure('protocol-failure');
  const model =
    (environment.CODESIGN_CODEX_MODEL ?? environment.MALLEABLE_CODEX_MODEL)?.trim() ||
    DEFAULT_CODEX_MODEL;
  const effort =
    (environment.CODESIGN_CODEX_EFFORT ?? DEFAULT_CODEX_EFFORT).trim().toLowerCase() ||
    DEFAULT_CODEX_EFFORT;
  if (!validEfforts.has(effort)) throw new ProviderFailure('protocol-failure');
  return {
    provider: configuredProvider,
    model,
    effort,
    command: resolveCodexCommand(
      environment.CODESIGN_CODEX_COMMAND ?? environment.MALLEABLE_CODEX_COMMAND,
    ),
  };
}

function parseCandidate(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return agentCandidateBatchSchema.parse(JSON.parse(trimmed) as unknown);
  } catch (cause) {
    throw asProviderFailure(cause);
  }
}

export class LocalCodesignProvider implements CodesignProvider {
  readonly descriptor = LOCAL_PROVIDER_DESCRIPTOR;

  async status(): Promise<ProviderStatus> {
    return {
      provider: 'local',
      available: true,
      connected: true,
      authMode: null,
      planType: null,
      accountLabel: null,
      message: 'Deterministic local generation is ready.',
    };
  }

  async generate(input: ProviderGenerationInput) {
    try {
      return localCandidateBatch(input.request, input.run);
    } catch (cause) {
      throw asProviderFailure(cause);
    }
  }
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

  async logout() {
    try {
      await this.client.logout();
    } catch (cause) {
      throw asProviderFailure(cause);
    }
  }

  async generate(input: ProviderGenerationInput) {
    if (!input.prompt) throw new ProviderFailure('protocol-failure');
    try {
      const text = await this.client.proposeCandidate(
        input.prompt,
        input.signal,
        input.visualInput,
        {
          model: input.model ?? this.model,
          effort: input.effort ?? this.effort,
        },
      );
      return parseCandidate(text);
    } catch (cause) {
      throw asProviderFailure(cause);
    }
  }
}

export function createProvider(settings = providerSettings()): CodesignProvider {
  if (settings.provider === 'local') return new LocalCodesignProvider();
  return new CodexCodesignProvider(
    getCodexClient(settings.command, settings.model, settings.effort),
    settings.model,
    settings.effort,
  );
}

export function configuredCodexProvider(settings = providerSettings()) {
  return new CodexCodesignProvider(
    getCodexClient(settings.command, settings.model, settings.effort),
    settings.model,
    settings.effort,
  );
}
