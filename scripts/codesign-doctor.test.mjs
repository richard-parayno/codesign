import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  formatDoctorResult,
  inspectCodexVersion,
  probeAppServer,
  resolveExecutable,
  runCommand,
  runDoctor,
} from './codesign-doctor.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function fakeCommandRunner({ version = 'codex-cli 0.144.1', versionResult, helpResult } = {}) {
  return async (command, args) => {
    if (args[0] === '--version')
      return versionResult ?? { ok: true, stdout: `${version}\n`, stderr: '', timedOut: false };
    if (args[0] === 'app-server' && args[1] === '--help')
      return helpResult ?? { ok: true, stdout: 'App Server\n', stderr: '', timedOut: false };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
}

const authenticatedProbe = {
  ok: true,
  initialized: true,
  authenticated: true,
  authMode: 'chatgpt',
  capabilitiesAvailable: true,
  model: 'gpt-5.6-luna',
  effort: 'high',
};

async function doctor(overrides = {}) {
  return runDoctor({
    projectRoot,
    nodeVersion: '22.17.2',
    environment: { PATH: '', npm_config_user_agent: 'pnpm/10.15.0 npm/? node/v22.17.2' },
    resolveExecutable: () => '/tmp/fake Codex/codex',
    runCommand: fakeCommandRunner(),
    probeAppServer: async () => authenticatedProbe,
    ...overrides,
  });
}

test('a valid separately installed Codex runtime is ready', async () => {
  const result = await doctor();

  assert.equal(result.exitCode, 0);
  assert.equal(result.resolvedCommand, '/tmp/fake Codex/codex');
  assert.match(formatDoctorResult(result), /✓ Signed in with ChatGPT/);
  assert.match(formatDoctorResult(result), /Codesign is ready\./);
});

test('a missing Codex executable fails with install and login guidance', async () => {
  const result = await doctor({ resolveExecutable: () => null });
  const output = formatDoctorResult(result);

  assert.equal(result.exitCode, 1);
  assert.match(output, /✗ Codex CLI was not found/);
  assert.match(output, /npm install --global @openai\/codex/);
  assert.match(output, /codex login/);
});

test('malformed Codex version output is blocking', async () => {
  const result = await doctor({ runCommand: fakeCommandRunner({ version: 'development' }) });
  assert.equal(result.exitCode, 1);
  assert.match(formatDoctorResult(result), /malformed version output/);
});

test('an incompatible Codex version is blocking', async () => {
  const result = await doctor({ runCommand: fakeCommandRunner({ version: 'codex 0.144.0' }) });
  assert.equal(result.exitCode, 1);
  assert.match(formatDoctorResult(result), />=0\.144\.1 <0\.145\.0/);
});

test('App Server initialization failure is blocking and safely summarized', async () => {
  const result = await doctor({
    probeAppServer: async () => ({ ok: false, error: new Error('secret backend detail') }),
  });
  const output = formatDoctorResult(result);

  assert.equal(result.exitCode, 1);
  assert.match(output, /App Server initialization failed/);
  assert.doesNotMatch(output, /secret backend detail/);
});

test('an unauthenticated App Server is blocking without starting login', async () => {
  const result = await doctor({
    probeAppServer: async () => ({
      ...authenticatedProbe,
      authenticated: false,
      authMode: null,
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(formatDoctorResult(result), /Run codex login/);
});

test('a timed out child process is terminated and reported without stderr', async () => {
  const result = await runCommand(
    process.execPath,
    ['--eval', "process.stderr.write('sensitive'); setInterval(() => {}, 1000)"],
    { timeoutMs: 40 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.stderr, '');
});

test('a hung App Server is terminated at the bounded probe timeout', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  const result = await probeAppServer('/tmp/hung-codex', {
    timeoutMs: 20,
    spawnProcess: () => child,
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(child.killed, true);
});

test('PATH lookup supports a resolved path containing spaces without adding a node_modules fallback', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codesign doctor '));
  const binDirectory = join(temporaryRoot, 'user bin');
  const executable = join(binDirectory, 'codex');
  await mkdir(binDirectory);
  await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  try {
    assert.equal(resolveExecutable('codex', { PATH: binDirectory }, 'linux'), executable);
    assert.equal(resolveExecutable('codex', { PATH: '' }, 'linux'), null);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('the App Server probe initializes, reads auth, lists models, and performs no AI or login action', async () => {
  const messages = [];
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  let buffered = '';
  child.stdin.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.method === 'initialize')
        child.stdout.write(
          `${JSON.stringify({ id: message.id, result: { userAgent: 'fake' } })}\n`,
        );
      if (message.method === 'account/read')
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              account: { type: 'chatgpt', email: 'private@example.test', planType: 'plus' },
              requiresOpenaiAuth: true,
            },
          })}\n`,
        );
      if (message.method === 'model/list')
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              data: [
                {
                  id: 'gpt-5.6-luna',
                  model: 'gpt-5.6-luna',
                  supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
                },
              ],
              nextCursor: null,
            },
          })}\n`,
        );
    }
  });

  const result = await probeAppServer('/tmp/fake-codex', {
    timeoutMs: 250,
    spawnProcess: () => child,
  });

  assert.deepEqual(
    messages.map((message) => message.method),
    ['initialize', 'initialized', 'account/read', 'model/list'],
  );
  assert.equal(messages[2].params.refreshToken, false);
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.capabilitiesAvailable, true);
  assert.equal(child.killed, true);
  assert.equal(JSON.stringify(result).includes('private@example.test'), false);
});

test('version parser accepts only the tested patch range', () => {
  assert.deepEqual(inspectCodexVersion('codex-cli 0.144.1'), {
    valid: true,
    compatible: true,
    display: '0.144.1',
  });
  assert.equal(inspectCodexVersion('codex-cli 0.145.0').compatible, false);
});
