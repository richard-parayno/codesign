import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ThreadStartParams } from '../../../.generated/codex-app-server/v2/ThreadStartParams';
import type { TurnStartParams } from '../../../.generated/codex-app-server/v2/TurnStartParams';

type RpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type SpawnFactory = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; shell: false; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

function proposalOutputSchema(intent: 'interpret' | 'promote') {
  const operation =
    intent === 'interpret'
      ? {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'actor', 'targetIds', 'repeaterId'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['repeat'] },
            actor: { type: 'string', enum: ['agent'] },
            targetIds: { type: 'array', minItems: 2, items: { type: 'string' } },
            repeaterId: { type: 'string' },
          },
        }
      : {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'actor', 'targetIds', 'componentId', 'props'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['promote'] },
            actor: { type: 'string', enum: ['agent'] },
            targetIds: { type: 'array', minItems: 1, items: { type: 'string' } },
            componentId: {
              type: 'string',
              enum: [
                'Card',
                'DataRow',
                'DataTable',
                'Sidebar',
                'NavItem',
                'Button',
                'Input',
                'Badge',
                'Panel',
              ],
            },
            props: {
              type: 'object',
              additionalProperties: false,
              required: [
                'density',
                'radius',
                'interactive',
                'collapsed',
                'active',
                'variant',
                'size',
                'tone',
                'side',
              ],
              properties: {
                density: {
                  type: ['string', 'null'],
                  enum: ['compact', 'comfortable', null],
                },
                radius: { type: ['string', 'null'], enum: ['small', 'medium', null] },
                interactive: { type: ['boolean', 'null'] },
                collapsed: { type: ['boolean', 'null'] },
                active: { type: ['boolean', 'null'] },
                variant: {
                  type: ['string', 'null'],
                  enum: ['primary', 'secondary', 'ghost', null],
                },
                size: { type: ['string', 'null'], enum: ['small', 'medium', null] },
                tone: {
                  type: ['string', 'null'],
                  enum: ['neutral', 'success', 'accent', null],
                },
                side: { type: ['string', 'null'], enum: ['left', 'right', null] },
              },
            },
          },
        };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'baseRevision', 'targetIds', 'operation', 'rationale', 'confidence', 'source'],
    properties: {
      id: { type: 'string' },
      baseRevision: { type: 'integer', minimum: 0 },
      targetIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      operation,
      rationale: { type: 'string', maxLength: 500 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      source: { type: 'string', enum: ['codex'] },
    },
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
  private nextId = 1;
  private threadId: string | null = null;
  private initialized: Promise<void> | null = null;

  constructor(
    private command = 'codex',
    private model?: string,
    private spawnProcess: SpawnFactory = spawn,
  ) {}

  private start() {
    if (this.initialized) return this.initialized;
    this.initialized = new Promise<void>((resolve, reject) => {
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
          /* Ignore non-protocol output safely. */
        }
      });
      child.stderr.on('data', () => {
        /* Deliberately avoid logging content or document data. */
      });
      child.once('error', (error) => {
        this.failAll(error);
        reject(error);
      });
      child.once('exit', () => {
        const error = new Error('Codex App Server stopped unexpectedly');
        this.failAll(error);
        this.process = null;
        this.initialized = null;
        this.threadId = null;
      });
      this.request(
        'initialize',
        {
          clientInfo: { name: 'malleable', title: 'Malleable', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        },
        8_000,
      )
        .then(() => {
          this.notify('initialized', {});
          resolve();
        })
        .catch(reject);
    });
    return this.initialized;
  }

  private write(message: RpcMessage) {
    if (!this.process?.stdin.writable) throw new Error('Codex App Server is not running');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeout = 15_000) {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params: params as Record<string, unknown> });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.write({ method, params });
  }

  private handle(message: RpcMessage) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(message.error.message ?? 'Codex App Server request failed'));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      const mutationRequest =
        message.method.includes('requestApproval') ||
        message.method.includes('requestUserInput') ||
        message.method.includes('elicitation');
      this.write(
        mutationRequest
          ? { id: message.id, result: { decision: 'decline' } }
          : ({
              id: message.id,
              error: { code: -32601, message: 'Unsupported server request' },
            } as RpcMessage),
      );
      return;
    }
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

  private async ensureThread() {
    await this.start();
    if (this.threadId) return this.threadId;
    const params: ThreadStartParams = {
      model: this.model || null,
      cwd: process.cwd(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      baseInstructions:
        'You are Malleable’s constrained design interpreter. Never use tools, shell, files, or network. Return only the requested typed design-operation proposal using existing IDs and registered component names.',
    };
    const response = (await this.request('thread/start', params, 15_000)) as {
      thread?: { id?: string };
    };
    if (!response.thread?.id) throw new Error('Codex App Server did not return a thread ID');
    this.threadId = response.thread.id;
    return this.threadId;
  }

  async propose(prompt: string, signal?: AbortSignal, intent: 'interpret' | 'promote' = 'promote') {
    const threadId = await this.ensureThread();
    const params: TurnStartParams = {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model: this.model || null,
      outputSchema: proposalOutputSchema(intent),
    };
    const response = (await this.request('turn/start', params, 15_000)) as {
      turn?: { id?: string };
    };
    const turnId = response.turn?.id;
    if (!turnId) throw new Error('Codex App Server did not return a turn ID');
    return new Promise<string>((resolve, reject) => {
      const early = this.earlyTurns.get(turnId);
      if (early?.completed) {
        this.earlyTurns.delete(turnId);
        early.error ? reject(new Error(early.error)) : resolve(early.text);
        return;
      }
      const timer = setTimeout(() => {
        this.request('turn/interrupt', { threadId, turnId }, 3_000).catch(() => {});
        this.turns.delete(turnId);
        reject(new Error('Codex interpretation timed out'));
      }, 45_000);
      this.turns.set(turnId, { text: early?.text ?? '', resolve, reject, timer });
      this.earlyTurns.delete(turnId);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          this.turns.delete(turnId);
          this.request('turn/interrupt', { threadId, turnId }, 3_000).catch(() => {});
          reject(new Error('Codex interpretation cancelled'));
        },
        { once: true },
      );
    });
  }

  shutdown() {
    this.process?.kill('SIGTERM');
    this.process = null;
    this.initialized = null;
    this.threadId = null;
  }
}

declare global {
  var __malleableCodex: CodexAppServer | undefined;
}
export function getCodexClient(command: string, model?: string) {
  return (globalThis.__malleableCodex ??= new CodexAppServer(command, model));
}
