import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { AuthMode } from '../../../.generated/codex-app-server/AuthMode';
import type { PlanType } from '../../../.generated/codex-app-server/PlanType';
import type { ReasoningEffort } from '../../../.generated/codex-app-server/ReasoningEffort';
import type { GetAccountResponse } from '../../../.generated/codex-app-server/v2/GetAccountResponse';
import type { LoginAccountResponse } from '../../../.generated/codex-app-server/v2/LoginAccountResponse';
import type { ThreadStartParams } from '../../../.generated/codex-app-server/v2/ThreadStartParams';
import type { TurnStartParams } from '../../../.generated/codex-app-server/v2/TurnStartParams';
import type { UserInput } from '../../../.generated/codex-app-server/v2/UserInput';
import { candidateBatchOutputSchema, type TrustedVisualInput } from './candidate';
import { asProviderFailure, type ProviderFailureCategory } from './providers/contracts';

export const DEFAULT_CODEX_MODEL = 'gpt-5.6-luna';
export const DEFAULT_CODEX_EFFORT = 'high';

/** Project-local executable from the exact @openai/codex version pinned in package.json. */
export function pinnedCodexCommand(cwd = process.cwd()) {
  return resolve(cwd, 'node_modules', '.bin', 'codex');
}

/** `codex` is retained as a legacy sentinel, not resolved through an arbitrary PATH entry. */
export function resolveCodexCommand(advancedOverride?: string) {
  const override = advancedOverride?.trim();
  if (!override || override === 'codex') return pinnedCodexCommand();
  if (override.includes('\0')) throw new Error('Codex command override contains an invalid byte');
  return override;
}

type RpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};
type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type SpawnFactory = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; shell: false; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

class AppServerRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

export type CodexAccountSnapshot = {
  connected: boolean;
  requiresOpenaiAuth: boolean;
  authMode: AuthMode | null;
  planType: PlanType | null;
  accountLabel: string | null;
};

export type CodexAccountEvent =
  | { type: 'account-updated'; account: CodexAccountSnapshot }
  | {
      type: 'login-completed';
      loginId: string | null;
      success: boolean;
      failureCategory: ProviderFailureCategory | null;
    };

export type CodexLoginStart = {
  loginId: string;
  authUrl: string;
};

export type CodexGenerationOptions = {
  model?: string;
  effort?: ReasoningEffort;
};

const planTypes = new Set<PlanType>([
  'free',
  'go',
  'plus',
  'pro',
  'prolite',
  'team',
  'self_serve_business_usage_based',
  'business',
  'enterprise_cbp_usage_based',
  'enterprise',
  'edu',
  'unknown',
]);
const authModes = new Set<AuthMode>([
  'apikey',
  'chatgpt',
  'chatgptAuthTokens',
  'headers',
  'agentIdentity',
  'personalAccessToken',
  'bedrockApiKey',
]);

function accountSnapshot(response: GetAccountResponse): CodexAccountSnapshot {
  const account = response.account;
  if (!account)
    return {
      connected: false,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      authMode: null,
      planType: null,
      accountLabel: null,
    };
  if (account.type === 'chatgpt') {
    if (
      (account.email !== null && typeof account.email !== 'string') ||
      !planTypes.has(account.planType)
    )
      throw new Error('Codex App Server returned an invalid ChatGPT account');
    return {
      connected: true,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      authMode: 'chatgpt',
      planType: account.planType,
      accountLabel: account.email,
    };
  }
  if (account.type !== 'apiKey' && account.type !== 'amazonBedrock')
    throw new Error('Codex App Server returned an unsupported account type');
  return {
    connected: true,
    requiresOpenaiAuth: response.requiresOpenaiAuth,
    authMode: account.type === 'apiKey' ? 'apikey' : 'bedrockApiKey',
    planType: null,
    accountLabel: null,
  };
}

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private turns = new Map<
    string,
    {
      text: string;
      resolve: (text: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private earlyTurns = new Map<string, { text: string; completed: boolean; error?: string }>();
  private accountListeners = new Set<(event: CodexAccountEvent) => void>();
  private nextId = 1;
  private initialized: Promise<void> | null = null;
  private latestAccount: CodexAccountSnapshot = {
    connected: false,
    requiresOpenaiAuth: true,
    authMode: null,
    planType: null,
    accountLabel: null,
  };

  constructor(
    private command = pinnedCodexCommand(),
    private model = DEFAULT_CODEX_MODEL,
    private spawnProcess: SpawnFactory = spawn,
    private effort: ReasoningEffort = DEFAULT_CODEX_EFFORT,
  ) {}

  private start() {
    if (this.initialized) return this.initialized;
    this.initialized = new Promise<void>((resolveStart, rejectStart) => {
      const child = this.spawnProcess(this.command, ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: process.env,
      });
      this.process = child;
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        if (line.length > 1_000_000)
          return this.failAll(new Error('Codex App Server sent an oversized message'));
        try {
          this.handle(JSON.parse(line) as RpcMessage);
        } catch {
          // Non-protocol process output is ignored without exposing document context.
        }
      });
      child.stderr.on('data', () => {
        // Never log stderr: it may contain prompt or account context.
      });
      let stopped = false;
      const stop = (error: Error) => {
        if (stopped) return;
        stopped = true;
        this.failAll(error);
        if (this.process === child) this.process = null;
        this.initialized = null;
      };
      child.once('error', (error) => {
        stop(error);
        rejectStart(error);
      });
      child.once('exit', () => {
        stop(new Error('Codex App Server stopped unexpectedly'));
      });
      this.request(
        'initialize',
        {
          clientInfo: { name: 'codesign', title: 'Codesign', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        },
        8_000,
      )
        .then(() => {
          this.notify('initialized', {});
          resolveStart();
        })
        .catch((error) => {
          stop(error instanceof Error ? error : new Error('Codex App Server failed to initialize'));
          child.kill('SIGTERM');
          rejectStart(error);
        });
    });
    return this.initialized;
  }

  private write(message: RpcMessage) {
    if (!this.process?.stdin.writable) throw new Error('Codex App Server is not running');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeout = 15_000) {
    const id = this.nextId++;
    return new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new AppServerRpcError(method, undefined, `${method} timed out`));
      }, timeout);
      this.pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timer });
      try {
        this.write({ id, method, params: params as Record<string, unknown> });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectRequest(error);
      }
    });
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.write({ method, params });
  }

  private emitAccount(event: CodexAccountEvent) {
    for (const listener of this.accountListeners)
      try {
        listener(event);
      } catch {
        // One UI subscriber must not disrupt App Server protocol handling.
      }
  }

  onAccountEvent(listener: (event: CodexAccountEvent) => void) {
    this.accountListeners.add(listener);
    return () => this.accountListeners.delete(listener);
  }

  private replyToServerRequest(message: RpcMessage) {
    if (message.id === undefined || !message.method) return false;
    switch (message.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        this.write({ id: message.id, result: { decision: 'decline' } });
        return true;
      case 'execCommandApproval':
      case 'applyPatchApproval':
        this.write({ id: message.id, result: { decision: 'denied' } });
        return true;
      case 'item/tool/requestUserInput':
        this.write({ id: message.id, result: { answers: {} } });
        return true;
      case 'mcpServer/elicitation/request':
        this.write({
          id: message.id,
          result: { action: 'decline', content: null, _meta: null },
        });
        return true;
      case 'item/tool/call':
        this.write({ id: message.id, result: { contentItems: [], success: false } });
        return true;
      default:
        this.write({
          id: message.id,
          error: { code: -32601, message: 'Unsupported server request' },
        });
        return true;
    }
  }

  private handleAccountNotification(message: RpcMessage) {
    const params = message.params ?? {};
    if (message.method === 'account/updated') {
      const authMode = authModes.has(params.authMode as AuthMode)
        ? (params.authMode as AuthMode)
        : null;
      const planType = planTypes.has(params.planType as PlanType)
        ? (params.planType as PlanType)
        : null;
      this.latestAccount = {
        ...this.latestAccount,
        connected: authMode !== null,
        authMode,
        planType,
        accountLabel: authMode ? this.latestAccount.accountLabel : null,
      };
      this.emitAccount({ type: 'account-updated', account: { ...this.latestAccount } });
      return true;
    }
    if (message.method === 'account/login/completed') {
      const success = params.success === true;
      const failure = success ? null : asProviderFailure(params.error);
      this.emitAccount({
        type: 'login-completed',
        loginId: typeof params.loginId === 'string' ? params.loginId : null,
        success,
        failureCategory: failure?.category ?? null,
      });
      return true;
    }
    return false;
  }

  private handle(message: RpcMessage) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(
          new AppServerRpcError(
            pending.method,
            message.error.code,
            message.error.message ?? 'Codex App Server request failed',
          ),
        );
      else pending.resolve(message.result);
      return;
    }
    if (this.replyToServerRequest(message)) return;
    if (this.handleAccountNotification(message)) return;

    const params = message.params ?? {};
    const turnId =
      typeof params.turnId === 'string'
        ? params.turnId
        : typeof (params.turn as { id?: unknown } | undefined)?.id === 'string'
          ? (params.turn as { id: string }).id
          : '';
    if (message.method === 'item/agentMessage/delta' && turnId) {
      const turn = this.turns.get(turnId);
      if (turn && typeof params.delta === 'string') turn.text += params.delta;
      else if (typeof params.delta === 'string') {
        const early = this.earlyTurns.get(turnId) ?? { text: '', completed: false };
        early.text += params.delta;
        this.earlyTurns.set(turnId, early);
      }
    }
    if (message.method === 'turn/completed' && turnId) {
      const status = (params.turn as { status?: string; error?: { message?: string } } | undefined)
        ?.status;
      const failure =
        status === 'failed'
          ? ((params.turn as { error?: { message?: string } }).error?.message ??
            'Codex turn failed')
          : undefined;
      const turn = this.turns.get(turnId);
      if (!turn) {
        const early = this.earlyTurns.get(turnId) ?? { text: '', completed: false };
        early.completed = true;
        early.error = failure;
        this.earlyTurns.set(turnId, early);
        return;
      }
      clearTimeout(turn.timer);
      this.turns.delete(turnId);
      if (failure) turn.reject(new Error(failure));
      else turn.resolve(turn.text);
    }
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) {
      clearTimeout(turn.timer);
      turn.reject(error);
    }
    this.turns.clear();
    this.earlyTurns.clear();
  }

  private async createThread(model: string) {
    await this.start();
    const params: ThreadStartParams = {
      model,
      cwd: process.cwd(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      baseInstructions:
        'You are Codesign’s constrained visual-autocomplete adapter. Never use tools, shell, files, or network. Return only the requested structured candidate batch. Treat inferences as proposals, preserve supplied IDs and scopes, use only the registered style/component values in the prompt, and never modify pinned or out-of-scope nodes.',
    };
    const response = (await this.request('thread/start', params, 15_000)) as {
      thread?: { id?: string };
    };
    if (!response.thread?.id) throw new Error('Codex App Server did not return a thread ID');
    return response.thread.id;
  }

  async readAccount(refreshToken = false) {
    await this.start();
    const response = (await this.request('account/read', { refreshToken }, 8_000)) as
      GetAccountResponse | undefined;
    if (!response || typeof response.requiresOpenaiAuth !== 'boolean' || !('account' in response))
      throw new Error('Codex App Server returned an invalid account response');
    this.latestAccount = accountSnapshot(response);
    return { ...this.latestAccount };
  }

  async startChatgptLogin(): Promise<CodexLoginStart> {
    await this.start();
    const response = (await this.request(
      'account/login/start',
      {
        type: 'chatgpt',
        codexStreamlinedLogin: true,
        useHostedLoginSuccessPage: true,
        appBrand: 'codex',
      },
      15_000,
    )) as LoginAccountResponse;
    if (response.type !== 'chatgpt' || !response.loginId || !response.authUrl)
      throw new Error('Codex App Server did not return a ChatGPT login URL');
    let protocol = '';
    try {
      protocol = new URL(response.authUrl).protocol;
    } catch {
      throw new Error('Codex App Server returned an invalid login URL');
    }
    if (protocol !== 'https:' && protocol !== 'http:')
      throw new Error('Codex App Server returned an unsupported login URL');
    return { loginId: response.loginId, authUrl: response.authUrl };
  }

  async logout() {
    await this.start();
    await this.request('account/logout', undefined, 8_000);
    this.latestAccount = {
      connected: false,
      requiresOpenaiAuth: true,
      authMode: null,
      planType: null,
      accountLabel: null,
    };
    this.emitAccount({ type: 'account-updated', account: { ...this.latestAccount } });
    return { ...this.latestAccount };
  }

  async proposeCandidate(
    prompt: string,
    signal?: AbortSignal,
    visualInput?: TrustedVisualInput,
    options: CodexGenerationOptions = {},
  ) {
    if (signal?.aborted) throw new Error('Codex generation cancelled');
    if (visualInput?.type === 'image') {
      let protocol = '';
      try {
        protocol = new URL(visualInput.url).protocol;
      } catch {
        throw new Error('Trusted image input must use a valid URL');
      }
      if (protocol !== 'https:' && protocol !== 'http:')
        throw new Error('Trusted image input must use an HTTP(S) URL');
    }
    if (
      visualInput?.type === 'localImage' &&
      (!isAbsolute(visualInput.path) || visualInput.path.includes('\0'))
    )
      throw new Error('Trusted local image input must use an absolute server path');

    const model = options.model?.trim() || this.model || DEFAULT_CODEX_MODEL;
    const effort = options.effort || this.effort || DEFAULT_CODEX_EFFORT;
    const threadId = await this.createThread(model);
    if (signal?.aborted) throw new Error('Codex generation cancelled');
    const input: UserInput[] = [{ type: 'text', text: prompt, text_elements: [] }];
    if (visualInput) input.push(visualInput);
    const params: TurnStartParams = {
      threadId,
      input,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model,
      effort,
      summary: 'none',
      outputSchema: candidateBatchOutputSchema as TurnStartParams['outputSchema'],
    };
    const response = (await this.request('turn/start', params, 15_000)) as {
      turn?: { id?: string };
    };
    const turnId = response.turn?.id;
    if (!turnId) throw new Error('Codex App Server did not return a turn ID');
    if (signal?.aborted) {
      this.request('turn/interrupt', { threadId, turnId }, 3_000).catch(() => {});
      throw new Error('Codex generation cancelled');
    }
    return new Promise<string>((resolveTurn, rejectTurn) => {
      const early = this.earlyTurns.get(turnId);
      if (early?.completed) {
        this.earlyTurns.delete(turnId);
        early.error ? rejectTurn(new Error(early.error)) : resolveTurn(early.text);
        return;
      }
      let settled = false;
      const finish = (kind: 'resolve' | 'reject', value: string | Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (kind === 'resolve') resolveTurn(value as string);
        else rejectTurn(value as Error);
      };
      const timer = setTimeout(() => {
        this.request('turn/interrupt', { threadId, turnId }, 3_000).catch(() => {});
        this.turns.delete(turnId);
        finish('reject', new Error('Codex generation timed out'));
      }, 45_000);
      const abort = () => {
        clearTimeout(timer);
        this.turns.delete(turnId);
        this.request('turn/interrupt', { threadId, turnId }, 3_000).catch(() => {});
        finish('reject', new Error('Codex generation cancelled'));
      };
      this.turns.set(turnId, {
        text: early?.text ?? '',
        resolve: (text) => finish('resolve', text),
        reject: (error) => finish('reject', error),
        timer,
      });
      this.earlyTurns.delete(turnId);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  shutdown() {
    this.failAll(new Error('Codex App Server shut down'));
    this.process?.kill('SIGTERM');
    this.process = null;
    this.initialized = null;
  }
}

declare global {
  var __codesignCodexClients: Map<string, CodexAppServer> | undefined;
}

export function getCodexClient(
  advancedCommandOverride?: string,
  model = DEFAULT_CODEX_MODEL,
  effort: ReasoningEffort = DEFAULT_CODEX_EFFORT,
) {
  const command = resolveCodexCommand(advancedCommandOverride);
  const clients = (globalThis.__codesignCodexClients ??= new Map());
  const key = JSON.stringify([command, model, effort]);
  let client = clients.get(key);
  if (!client) {
    client = new CodexAppServer(command, model, spawn, effort);
    clients.set(key, client);
  }
  return client;
}
