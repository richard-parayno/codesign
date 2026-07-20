import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CANDIDATE_SCHEMA_VERSION } from './candidate';
import { CodexAppServer } from './codex-client.server';

type Rpc = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };

function fakeProcess(options: { complete?: boolean } = {}) {
  const messages: Rpc[] = [];
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr, kill: () => true });
  let buffered = '';
  stdin.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const message = JSON.parse(line) as Rpc;
      messages.push(message);
      if (message.method === 'initialize')
        stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'fake' } })}\n`);
      if (message.method === 'thread/start')
        stdout.write(
          `${JSON.stringify({ id: message.id, result: { thread: { id: 'thread-1' } } })}\n`,
        );
      if (message.method === 'turn/start') {
        stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
        if (options.complete !== false)
          queueMicrotask(() => {
            stdout.write(
              `${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: '{"schema' } })}\n`,
            );
            stdout.write(
              `${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'Version":"ok"}' } })}\n`,
            );
            stdout.write(
              `${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } } })}\n`,
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
  it('uses a read-only turn, candidate schema, and the pinned localImage input shape', async () => {
    const fake = fakeProcess();
    const client = new CodexAppServer('fake-codex', 'fake-model', () => fake.child);

    await expect(
      client.proposeCandidate('Return a candidate', undefined, {
        type: 'localImage',
        path: '/trusted/snapshots/context.png',
        detail: 'high',
      }),
    ).resolves.toBe('{"schemaVersion":"ok"}');

    const thread = fake.messages.find((message) => message.method === 'thread/start')!;
    expect(thread.params).toMatchObject({
      model: 'fake-model',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    const turn = fake.messages.find((message) => message.method === 'turn/start')!;
    expect(turn.params).toMatchObject({
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

  it('uses the pinned URL image input shape without translating it to legacy image_url', async () => {
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
});
