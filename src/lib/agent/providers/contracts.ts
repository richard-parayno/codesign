import type { ReasoningEffort } from '../../../../.generated/codex-app-server/ReasoningEffort';
import type { AgentCandidateBatch, GenerationRequest, TrustedVisualInput } from '../candidate';
import type { GenerationRun } from '$lib/model/types';

export type ProviderId = 'local' | 'codex';
export type ProviderFailureCategory =
  | 'missing-login'
  | 'model-unavailable'
  | 'rate-limited'
  | 'cancelled'
  | 'protocol-failure'
  | 'unavailable';

const publicFailureMessages: Record<ProviderFailureCategory, string> = {
  'missing-login': 'Sign in to Codex with ChatGPT before using AI generation.',
  'model-unavailable': 'The configured Codex model is unavailable for this account.',
  'rate-limited': 'Codex is temporarily rate limited. Try again later.',
  cancelled: 'Codesign generation was cancelled.',
  'protocol-failure': 'Codex could not complete the structured generation request.',
  unavailable: 'The local Codex runtime is unavailable.',
};

export class ProviderFailure extends Error {
  constructor(readonly category: ProviderFailureCategory) {
    super(publicFailureMessages[category]);
    this.name = 'ProviderFailure';
  }
}

/** Converts transport errors to a fixed, non-secret UI-safe category and message. */
export function asProviderFailure(cause: unknown): ProviderFailure {
  if (cause instanceof ProviderFailure) return cause;
  const message =
    cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  if (message.includes('cancel') || message.includes('abort') || message.includes('interrupt'))
    return new ProviderFailure('cancelled');
  if (
    message.includes('login') ||
    message.includes('sign in') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('401')
  )
    return new ProviderFailure('missing-login');
  if (
    message.includes('model') &&
    (message.includes('unavailable') ||
      message.includes('not found') ||
      message.includes('unsupported') ||
      message.includes('access'))
  )
    return new ProviderFailure('model-unavailable');
  if (
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('credit')
  )
    return new ProviderFailure('rate-limited');
  if (
    message.includes('enoent') ||
    message.includes('not running') ||
    message.includes('stopped unexpectedly') ||
    message.includes('spawn')
  )
    return new ProviderFailure('unavailable');
  return new ProviderFailure('protocol-failure');
}

export type ProviderCapabilities = {
  structuredCandidates: true;
  supportedActions: readonly ['complete'];
  visualInputs: readonly ('image' | 'localImage')[];
  authentication: 'none' | 'app-server-chatgpt';
  canStartLogin: boolean;
  canLogout: boolean;
  cancellation: boolean;
};

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;
};

export type ProviderStatus = {
  provider: ProviderId;
  available: boolean;
  connected: boolean;
  authMode: string | null;
  planType: string | null;
  accountLabel: string | null;
  failureCategory?: ProviderFailureCategory;
  message: string;
};

export type ProviderGenerationInput = {
  request: GenerationRequest;
  run: GenerationRun;
  prompt?: string;
  signal?: AbortSignal;
  visualInput?: TrustedVisualInput;
  model?: string;
  effort?: ReasoningEffort;
};

export type ProviderModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description: string;
  }>;
};

export interface CodesignProvider {
  readonly descriptor: ProviderDescriptor;
  status(): Promise<ProviderStatus>;
  models?(): Promise<ProviderModelOption[]>;
  generate(input: ProviderGenerationInput): Promise<AgentCandidateBatch>;
}
