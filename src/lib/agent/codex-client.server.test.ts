import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CANDIDATE_SCHEMA_VERSION } from './candidate';
import {
  CodexAppServer,
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  pinnedCodexCommand,
  resolveCodexCommand,
} from './codex-client.server';
import { asProviderFailure } from './providers/contracts';

type Rpc = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function fakeProcess(
  options: {
    complete?: boolean;
    errors?: Partial<Record<string, { code: number; message: string }>>;
    account?: unknown;
  } = {},
) {
  const messages: Rpc[] = [];
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr, kill: () => true });
  let buffered = '';
  let threadIndex = 0;
  let turnIndex = 0;
  stdin.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const message = JSON.parse(line) as Rpc;
      messages.push(message);
      const error = message.method ? options.errors?.[message.method] : undefined;
      if (error) {
        stdout.write(`${JSON.stringify({ id: message.id, error })}\n`);
        continue;
      }
      if (message.method === 'initialize')
        stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'fake' } })}\n`);
      if (message.method === 'account/read')
        stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: options.account ?? { account: null, requiresOpenaiAuth: true },
          })}\n`,
        );
      if (message.method === 'account/login/start')
        stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              type: 'chatgpt',
              loginId: 'login-1',
              authUrl: 'https://auth.example.test/codex',
            },
          })}\n`,
        );
      if (message.method === 'account/logout')
        stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
      if (message.method === 'model/list')
        stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              data: [
                {
                  id: 'luna',
                  model: 'gpt-5.6-luna',
                  displayName: 'GPT-5.6 Luna',
                  description: 'Visual coding model',
                  hidden: false,
                  supportedReasoningEfforts: [
                    { reasoningEffort: 'high', description: 'Deep reasoning' },
                  ],
                  defaultReasoningEffort: 'high',
                  inputModalities: ['text', 'image'],
                  supportsPersonality: false,
                  additionalSpeedTiers: [],
                  serviceTiers: [],
                  defaultServiceTier: null,
                  isDefault: true,
                  upgrade: null,
                  upgradeInfo: null,
                  availabilityNux: null,
                },
              ],
              nextCursor: null,
            },
          })}\n`,
        );
      if (message.method === 'thread/start') {
        threadIndex += 1;
        stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: { thread: { id: `thread-${threadIndex}` } },
          })}\n`,
        );
      }
      if (message.method === 'turn/start') {
        turnIndex += 1;
        const turnId = `turn-${turnIndex}`;
        const threadId = message.params?.threadId;
        stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: turnId } } })}\n`);
        if (options.complete !== false)
          queueMicrotask(() => {
            stdout.write(
              `${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'item-1', delta: '{"schema' } })}\n`,
            );
            stdout.write(
              `${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'item-1', delta: 'Version":"ok"}' } })}\n`,
            );
            stdout.write(
              `${JSON.stringify({
                method: 'thread/tokenUsage/updated',
                params: {
                  threadId,
                  turnId,
                  tokenUsage: {
                    total: {
                      totalTokens: 150,
                      inputTokens: 100,
                      cachedInputTokens: 20,
                      outputTokens: 50,
                      reasoningOutputTokens: 10,
                    },
                    last: {
                      totalTokens: 150,
                      inputTokens: 100,
                      cachedInputTokens: 20,
                      outputTokens: 50,
                      reasoningOutputTokens: 10,
                    },
                    modelContextWindow: 200_000,
                  },
                },
              })}\n`,
            );
            stdout.write(
              `${JSON.stringify({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', error: null, durationMs: 321 } } })}\n`,
            );
          });
      }
      if (message.method === 'turn/interrupt')
        stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    }
  });
  return { child, messages, stdout };
}

describe('Codex App Server JSONL transport', () => {
  it('uses the pinned model, high effort, no reasoning summary, schema, and localImage shape', async () => {
    const fake = fakeProcess();
    const client = new CodexAppServer('fake-codex', DEFAULT_CODEX_MODEL, () => fake.child);

    await expect(
      client.proposeCandidate('Return a candidate', undefined, {
        type: 'localImage',
        path: '/trusted/snapshots/context.png',
        detail: 'high',
      }),
    ).resolves.toBe('{"schemaVersion":"ok"}');

    const thread = fake.messages.find((message) => message.method === 'thread/start')!;
    expect(thread.params).toMatchObject({
      model: 'gpt-5.6-luna',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    const turn = fake.messages.find((message) => message.method === 'turn/start')!;
    expect(turn.params).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'high',
      summary: 'none',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      input: [
        { type: 'text', text: 'Return a candidate', text_elements: [] },
        { type: 'localImage', path: '/trusted/snapshots/context.png', detail: 'high' },
      ],
      outputSchema: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string', enum: [CANDIDATE_SCHEMA_VERSION] },
        },
      },
    });
    client.shutdown();
  });

  it('reuses one App Server process but creates a fresh ephemeral thread per generation', async () => {
    const fake = fakeProcess();
    let spawnCount = 0;
    const client = new CodexAppServer('fake-codex', undefined, () => {
      spawnCount += 1;
      return fake.child;
    });
    await client.proposeCandidate('First isolated run');
    await client.proposeCandidate('Second isolated run');

    expect(spawnCount).toBe(1);
    const threads = fake.messages.filter((message) => message.method === 'thread/start');
    const turns = fake.messages.filter((message) => message.method === 'turn/start');
    expect(threads).toHaveLength(2);
    expect(threads.every((message) => message.params?.ephemeral === true)).toBe(true);
    expect(turns.map((message) => message.params?.threadId)).toEqual(['thread-1', 'thread-2']);
    client.shutdown();
  });

  it('reports live output, exact App Server token usage, and turn duration', async () => {
    const fake = fakeProcess();
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    const telemetry: unknown[] = [];

    await client.proposeCandidate('Measure this run', undefined, undefined, {
      onTelemetry: (event) => telemetry.push(event),
    });

    expect(telemetry).toEqual([
      { type: 'output-started' },
      {
        type: 'token-usage',
        usage: {
          totalTokens: 150,
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 50,
          reasoningOutputTokens: 10,
          modelContextWindow: 200_000,
        },
      },
      { type: 'turn-completed', durationMs: 321 },
    ]);
    client.shutdown();
  });

  it('reads account state, starts App Server login, handles account notifications, and logs out', async () => {
    const fake = fakeProcess({
      account: {
        account: { type: 'chatgpt', email: 'designer@example.test', planType: 'plus' },
        requiresOpenaiAuth: true,
      },
    });
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    const events: unknown[] = [];
    const unsubscribe = client.onAccountEvent((event) => events.push(event));

    await expect(client.readAccount()).resolves.toEqual({
      connected: true,
      requiresOpenaiAuth: true,
      authMode: 'chatgpt',
      planType: 'plus',
      accountLabel: 'designer@example.test',
    });
    await expect(client.startChatgptLogin()).resolves.toEqual({
      loginId: 'login-1',
      authUrl: 'https://auth.example.test/codex',
    });
    fake.stdout.write(
      `${JSON.stringify({
        method: 'account/login/completed',
        params: { loginId: 'login-1', success: true, error: null },
      })}\n`,
    );
    fake.stdout.write(
      `${JSON.stringify({
        method: 'account/updated',
        params: { authMode: 'chatgpt', planType: 'pro' },
      })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual({
      type: 'login-completed',
      loginId: 'login-1',
      success: true,
      failureCategory: null,
    });
    expect(events).toContainEqual({
      type: 'account-updated',
      account: {
        connected: true,
        requiresOpenaiAuth: true,
        authMode: 'chatgpt',
        planType: 'pro',
        accountLabel: 'designer@example.test',
      },
    });
    await expect(client.logout()).resolves.toMatchObject({ connected: false, authMode: null });
    expect(fake.messages.map((message) => message.method)).toEqual(
      expect.arrayContaining(['account/read', 'account/login/start', 'account/logout']),
    );
    unsubscribe();
    client.shutdown();
  });

  it('reads a bounded model catalog from App Server', async () => {
    const fake = fakeProcess();
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);

    await expect(client.listModels()).resolves.toEqual([
      {
        id: 'luna',
        model: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        description: 'Visual coding model',
        isDefault: true,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }],
      },
    ]);
    expect(fake.messages.find((message) => message.method === 'model/list')?.params).toEqual({
      cursor: null,
      limit: 100,
      includeHidden: false,
    });
    client.shutdown();
  });

  it('maps login, model, rate-limit, cancellation, and protocol failures without exposing detail', async () => {
    for (const [message, category] of [
      ['authentication required for private account token', 'missing-login'],
      ['model gpt-secret is unavailable', 'model-unavailable'],
      ['429 rate limit for private workspace', 'rate-limited'],
      ['generation cancelled with private prompt', 'cancelled'],
      ['unexpected JSON-RPC response containing private context', 'protocol-failure'],
    ] as const) {
      const failure = asProviderFailure(new Error(message));
      expect(failure.category).toBe(category);
      expect(failure.message).not.toContain('private');
    }

    const fake = fakeProcess({
      errors: { 'turn/start': { code: -32601, message: 'unsupported protocol operation' } },
    });
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    await expect(client.proposeCandidate('No secret should escape')).rejects.toThrow(
      'unsupported protocol operation',
    );
    client.shutdown();
  });

  it('uses the pinned URL image shape without translating it to legacy image_url', async () => {
    const fake = fakeProcess();
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    await client.proposeCandidate('Use visual context', undefined, {
      type: 'image',
      url: 'https://assets.example.test/context.png',
      detail: 'low',
    });
    const turn = fake.messages.find((message) => message.method === 'turn/start')!;
    expect((turn.params?.input as unknown[])[1]).toEqual({
      type: 'image',
      url: 'https://assets.example.test/context.png',
      detail: 'low',
    });
    expect(JSON.stringify(turn.params?.input)).not.toContain('image_url');
    client.shutdown();
  });

  it('rejects browser data URLs before starting App Server', async () => {
    const fake = fakeProcess();
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    await expect(
      client.proposeCandidate('Do not forward this', undefined, {
        type: 'image',
        url: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow('HTTP(S)');
    expect(fake.messages).toEqual([]);
    client.shutdown();
  });

  it('cancels an in-flight generation through turn/interrupt', async () => {
    const fake = fakeProcess({ complete: false });
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    const controller = new AbortController();
    const pending = client.proposeCandidate('Wait for cancellation', controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toThrow('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.messages.some((message) => message.method === 'turn/interrupt')).toBe(true);
    client.shutdown();
  });

  it('uses method-specific safe replies for unexpected server requests', async () => {
    const fake = fakeProcess({ complete: false });
    const client = new CodexAppServer('fake-codex', undefined, () => fake.child);
    const controller = new AbortController();
    const pending = client.proposeCandidate('Exercise safe replies', controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.stdout.write(
      `${JSON.stringify({ id: 91, method: 'item/commandExecution/requestApproval', params: {} })}\n`,
    );
    fake.stdout.write(
      `${JSON.stringify({ id: 92, method: 'item/tool/requestUserInput', params: {} })}\n`,
    );
    fake.stdout.write(
      `${JSON.stringify({ id: 93, method: 'mcpServer/elicitation/request', params: {} })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.messages.find((message) => message.id === 91)?.result).toEqual({
      decision: 'decline',
    });
    expect(fake.messages.find((message) => message.id === 92)?.result).toEqual({ answers: {} });
    expect(fake.messages.find((message) => message.id === 93)?.result).toEqual({
      action: 'decline',
      content: null,
      _meta: null,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    client.shutdown();
  });

  it('defaults the legacy command sentinel to the project-pinned runtime', () => {
    expect(resolveCodexCommand()).toBe(pinnedCodexCommand());
    expect(resolveCodexCommand('codex')).toBe(pinnedCodexCommand());
    expect(resolveCodexCommand('/opt/advanced/codex')).toBe('/opt/advanced/codex');
    expect(DEFAULT_CODEX_EFFORT).toBe('high');
  });
});
