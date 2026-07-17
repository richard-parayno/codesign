import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CodexAppServer } from './codex-client.server';

function fakeProcess() {
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
      const message = JSON.parse(line);
      if (message.method === 'initialize')
        stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'fake' } })}\n`);
      if (message.method === 'thread/start')
        stdout.write(
          `${JSON.stringify({ id: message.id, result: { thread: { id: 'thread-1' } } })}\n`,
        );
      if (message.method === 'turn/start') {
        stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
        queueMicrotask(() => {
          stdout.write(
            `${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: '{"ok":true}' } })}\n`,
          );
          stdout.write(
            `${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } } })}\n`,
          );
        });
      }
    }
  });
  return child;
}

describe('Codex App Server JSONL transport', () => {
  it('handshakes, starts a constrained turn, and consumes fake streamed output', async () => {
    const client = new CodexAppServer('fake-codex', undefined, () => fakeProcess());
    await expect(client.propose('Return a proposal')).resolves.toBe('{"ok":true}');
    client.shutdown();
  });
});
