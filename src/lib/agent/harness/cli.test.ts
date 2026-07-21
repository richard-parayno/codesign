import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasSessionService } from './contracts';
import { CanvasSessionService as InMemoryCanvasSessionService } from './canvas-session.server';
import {
  CANVAS_HARNESS_HELP,
  parseCanvasCliCommand,
  runCanvasCli,
  runCanvasCliScript,
  type CanvasCliScript,
} from './cli';

function fakeService() {
  const sourceDocuments: unknown[] = [];
  const dispatch = vi.fn(async (_sessionId: string, tool: string) => ({ tool }));
  return {
    sourceDocuments,
    service: {
      createSession: vi.fn(async (input) => {
        sourceDocuments.push(input.document);
        return {
          id: 'session-cli',
          state: 'active',
          sourceRevisionId: input.document.currentRevisionId,
          candidateRevisionId: 'candidate-cli',
          expiresAt: Date.now() + 60_000,
        };
      }),
      dispatch,
      cancelSession: vi.fn(async () => true),
      cleanupExpired: vi.fn(async () => 0),
      dispose: vi.fn(async () => {}),
    } as unknown as CanvasSessionService,
    dispatch,
  };
}

describe('canvas harness CLI', () => {
  it('offers discoverable help and parses JSON commands', async () => {
    expect(CANVAS_HARNESS_HELP).toContain('candidate submit');
    await expect(
      parseCanvasCliCommand([
        'scene',
        'get-nodes',
        '--session',
        'session-1',
        '--json',
        '{"nodeIds":["node-1"]}',
      ]),
    ).resolves.toEqual({
      command: 'scene get-nodes',
      sessionId: 'session-1',
      input: { nodeIds: ['node-1'] },
    });
  });

  it('emits one machine-readable JSON result', async () => {
    const { service, dispatch } = fakeService();
    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(
      runCanvasCli(['candidate', 'validate', '--session', 'session-1'], service, {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(stdout[0])).toEqual({
      ok: true,
      result: { tool: 'candidate.validate' },
    });
    expect(stderr).toEqual([]);
    expect(dispatch).toHaveBeenCalledWith('session-1', 'candidate.validate', {});
  });

  it('runs the documented lifecycle fixture and verifies accepted source immutability', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/accepted-source-unchanged.json', import.meta.url), 'utf8'),
    ) as CanvasCliScript;
    const service = new InMemoryCanvasSessionService();
    try {
      const source = fixture.commands[0];
      if (source.command !== 'session create') throw new Error('Fixture must create a session');
      const result = await runCanvasCliScript(service, fixture);

      expect(result.sourceUnchanged).toBe(true);
      expect(result.results.map((entry) => (entry as { command: string }).command)).toEqual([
        'session create',
        'scene overview',
        'scene get-nodes',
        'candidate apply',
        'candidate validate',
        'candidate submit',
      ]);
      expect(source.input.document.nodes['rectangle-cli'].style.radius).toBe(0);
      const submitted = result.results[5] as {
        result: { candidate: { nodes: Record<string, { style: { radius: number } }> } };
      };
      expect(submitted.result.candidate.nodes['rectangle-cli'].style.radius).toBe(12);
    } finally {
      await service.dispose();
    }
  });
});
