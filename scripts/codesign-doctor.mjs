#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants, accessSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CODEX_COMMAND = 'codex';
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-luna';
export const DEFAULT_CODEX_EFFORT = 'high';
export const SUPPORTED_NODE_MAJOR = 22;
export const TESTED_CODEX_RANGE = '>=0.144.1 <0.145.0';

const CODEX_MINIMUM = [0, 144, 1];
const CODEX_MAXIMUM_EXCLUSIVE = [0, 145, 0];
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, '..');

function executableCandidates(command, environment, platform) {
  if (isAbsolute(command)) return [command];
  if (command.includes('/') || command.includes('\\')) return [resolve(command)];

  const extensions =
    platform === 'win32'
      ? (environment.PATHEXT || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((extension) => extension.toLowerCase())
      : [''];
  const hasKnownExtension = extensions.some(
    (extension) => extension && command.toLowerCase().endsWith(extension),
  );

  return (environment.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      hasKnownExtension
        ? [join(directory, command)]
        : extensions.map((extension) => join(directory, `${command}${extension}`)),
    );
}

export function resolveExecutable(command, environment = process.env, platform = process.platform) {
  const configured = command?.trim() || DEFAULT_CODEX_COMMAND;
  if (configured.includes('\0')) return null;

  for (const candidate of executableCandidates(configured, environment, platform)) {
    try {
      accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function collectChunk(current, chunk) {
  if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return current;
  const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current);
  return current + chunk.toString('utf8', 0, remaining);
}

function terminateChild(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 250);
  forceTimer.unref?.();
}

export function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnProcess = options.spawnProcess ?? spawn;

  return new Promise((resolveRun) => {
    let child;
    try {
      child = spawnProcess(command, args, {
        cwd: options.cwd,
        env: options.environment ?? process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolveRun({ ok: false, stdout: '', stderr: '', error, timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveRun({ stdout, stderr, timedOut: false, ...result });
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      terminateChild(child);
      settled = true;
      resolveRun({ ok: false, stdout, stderr: '', timedOut: true });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout = collectChunk(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = collectChunk(stderr, chunk);
    });
    child.once('error', (error) => finish({ ok: false, error }));
    child.once('exit', (code, signal) =>
      finish({ ok: code === 0, code, signal, error: undefined }),
    );
  });
}

function parseSemver(value) {
  const match = value.match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\s|$)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function inspectCodexVersion(output) {
  const version = parseSemver(output.trim());
  if (!version) return { valid: false, compatible: false, display: null };
  return {
    valid: true,
    compatible:
      compareVersion(version, CODEX_MINIMUM) >= 0 &&
      compareVersion(version, CODEX_MAXIMUM_EXCLUSIVE) < 0,
    display: version.join('.'),
  };
}

function rpcError(method, reason) {
  const error = new Error(`${method}: ${reason}`);
  error.code = 'APP_SERVER_PROTOCOL';
  return error;
}

export function probeAppServer(command, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnProcess = options.spawnProcess ?? spawn;
  const model = options.model ?? DEFAULT_CODEX_MODEL;
  const effort = options.effort ?? DEFAULT_CODEX_EFFORT;

  return new Promise((resolveProbe) => {
    let child;
    try {
      child = spawnProcess(command, ['app-server', '--stdio'], {
        cwd: options.cwd,
        env: options.environment ?? process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolveProbe({ ok: false, error });
      return;
    }

    let settled = false;
    let buffer = '';
    let nextId = 1;
    const pending = new Map();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      pending.clear();
      terminateChild(child);
      resolveProbe(result);
    };
    const overallTimer = setTimeout(
      () => finish({ ok: false, timedOut: true, error: rpcError('app-server', 'timed out') }),
      timeoutMs,
    );

    const send = (message) => {
      if (!child.stdin?.writable) throw rpcError('app-server', 'stdin is unavailable');
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const request = (method, params) => {
      const id = nextId++;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest });
        try {
          send({ id, method, params });
        } catch (error) {
          pending.delete(id);
          rejectRequest(error);
        }
      });
    };

    child.stderr?.on('data', () => {
      // App Server stderr may contain account or environment context. Never retain or print it.
    });
    child.once('error', (error) => finish({ ok: false, error }));
    child.once('exit', (code) => {
      if (!settled)
        finish({
          ok: false,
          error: rpcError('app-server', `exited with code ${code ?? 'unknown'}`),
        });
    });
    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > MAX_OUTPUT_BYTES) {
        finish({ ok: false, error: rpcError('app-server', 'sent oversized output') });
        return;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof message?.id !== 'number') continue;
        const requestState = pending.get(message.id);
        if (!requestState) continue;
        pending.delete(message.id);
        if (message.error) {
          requestState.reject(rpcError(requestState.method, 'request failed'));
        } else {
          requestState.resolve(message.result);
        }
      }
    });

    void (async () => {
      try {
        const initialized = await request('initialize', {
          clientInfo: { name: 'codesign-doctor', title: 'Codesign Doctor', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        });
        if (!initialized || typeof initialized !== 'object')
          throw rpcError('initialize', 'invalid response');
        send({ method: 'initialized', params: {} });

        const accountResponse = await request('account/read', { refreshToken: false });
        if (
          !accountResponse ||
          typeof accountResponse !== 'object' ||
          typeof accountResponse.requiresOpenaiAuth !== 'boolean' ||
          !Object.hasOwn(accountResponse, 'account')
        )
          throw rpcError('account/read', 'invalid response');
        const account = accountResponse.account;
        const authenticated = Boolean(
          account &&
          typeof account === 'object' &&
          ['chatgpt', 'apiKey', 'amazonBedrock'].includes(account.type),
        );
        const authMode = authenticated ? account.type : null;

        const modelsResponse = await request('model/list', {
          cursor: null,
          limit: 100,
          includeHidden: false,
        });
        if (
          !modelsResponse ||
          typeof modelsResponse !== 'object' ||
          !Array.isArray(modelsResponse.data)
        )
          throw rpcError('model/list', 'invalid response');
        const selectedModel = modelsResponse.data.find(
          (candidate) =>
            candidate &&
            typeof candidate === 'object' &&
            (candidate.model === model || candidate.id === model),
        );
        const efforts = Array.isArray(selectedModel?.supportedReasoningEfforts)
          ? selectedModel.supportedReasoningEfforts.map((item) => item?.reasoningEffort)
          : [];
        const capabilitiesAvailable = Boolean(selectedModel && efforts.includes(effort));

        finish({
          ok: true,
          initialized: true,
          authenticated,
          authMode,
          capabilitiesAvailable,
          model,
          effort,
        });
      } catch (error) {
        finish({ ok: false, error });
      }
    })();
  });
}

function packageExpectations(projectRoot) {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const packageManager =
      typeof packageJson.packageManager === 'string' ? packageJson.packageManager : null;
    const pnpmVersion = packageManager
      ?.match(/^pnpm@(\d+)\.(\d+)\.(\d+)$/)
      ?.slice(1)
      .map(Number);
    return { packageManager, pnpmVersion };
  } catch {
    return { packageManager: null, pnpmVersion: null };
  }
}

function detectedPnpmVersion(environment) {
  const match = environment.npm_config_user_agent?.match(/(?:^|\s)pnpm\/(\d+\.\d+\.\d+)/);
  return match ? parseSemver(match[1]) : null;
}

function check(kind, label, detail, blocking = kind === 'fail') {
  return { kind, label, detail, blocking };
}

function safeAuthLabel(authMode) {
  if (authMode === 'chatgpt') return 'Signed in with ChatGPT';
  if (authMode === 'apiKey') return 'Authenticated with Codex';
  if (authMode === 'amazonBedrock') return 'Authenticated with Amazon Bedrock';
  return 'Not signed in';
}

export async function runDoctor(options = {}) {
  const environment = options.environment ?? process.env;
  const projectRoot = options.projectRoot ?? defaultProjectRoot;
  const commandRunner = options.runCommand ?? runCommand;
  const appServerProbe = options.probeAppServer ?? probeAppServer;
  const executableResolver = options.resolveExecutable ?? resolveExecutable;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checks = [];

  const node = parseSemver(nodeVersion);
  checks.push(
    node?.[0] === SUPPORTED_NODE_MAJOR
      ? check('pass', `Node ${nodeVersion}`, 'Supported Node 22.x')
      : check('fail', `Node ${nodeVersion}`, 'Codesign requires Node 22.x'),
  );

  const expectations = packageExpectations(projectRoot);
  // `pnpm run doctor` supplies this user agent on every supported platform. Reading it avoids
  // invoking a platform-specific pnpm shim through a shell.
  const pnpmDetected = detectedPnpmVersion(environment);
  if (!expectations.packageManager || !expectations.pnpmVersion) {
    checks.push(
      check(
        'warn',
        'pnpm expectation unavailable',
        'package.json has no exact packageManager',
        false,
      ),
    );
  } else if (!pnpmDetected) {
    checks.push(
      check(
        'warn',
        'pnpm version was not detectable',
        `Run this command as pnpm run doctor; expected ${expectations.packageManager}`,
        false,
      ),
    );
  } else if (pnpmDetected[0] !== expectations.pnpmVersion[0]) {
    checks.push(
      check('fail', `pnpm ${pnpmDetected.join('.')}`, `Expected ${expectations.packageManager}`),
    );
  } else {
    checks.push(
      check(
        pnpmDetected.join('.') === expectations.pnpmVersion.join('.') ? 'pass' : 'warn',
        `pnpm ${pnpmDetected.join('.')}`,
        pnpmDetected.join('.') === expectations.pnpmVersion.join('.')
          ? `Matches ${expectations.packageManager}`
          : `Compatible major; ${expectations.packageManager} is recommended`,
        false,
      ),
    );
  }

  const configuredCommand = environment.CODESIGN_CODEX_COMMAND?.trim() || DEFAULT_CODEX_COMMAND;
  const resolvedCommand = executableResolver(configuredCommand, environment, options.platform);
  if (!resolvedCommand) {
    checks.push(
      check('fail', 'Codex CLI was not found', `Configured command: ${configuredCommand}`),
    );
    return { exitCode: 1, checks, resolvedCommand: null };
  }
  checks.push(check('pass', `Codex found: ${resolvedCommand}`, 'User-installed runtime'));

  const versionRun = await commandRunner(resolvedCommand, ['--version'], {
    cwd: projectRoot,
    environment,
    timeoutMs,
  });
  if (!versionRun.ok) {
    checks.push(
      check(
        'fail',
        versionRun.timedOut ? 'Codex version check timed out' : 'Codex version check failed',
        'Run codex --version directly for details',
      ),
    );
    return { exitCode: 1, checks, resolvedCommand };
  }
  const version = inspectCodexVersion(versionRun.stdout);
  if (!version.valid) {
    checks.push(
      check('fail', 'Codex returned malformed version output', 'Expected a semantic version'),
    );
    return { exitCode: 1, checks, resolvedCommand };
  }
  if (!version.compatible) {
    checks.push(
      check(
        'fail',
        `Codex ${version.display}`,
        `Tested compatibility range: ${TESTED_CODEX_RANGE}`,
      ),
    );
    return { exitCode: 1, checks, resolvedCommand, codexVersion: version.display };
  }
  checks.push(
    check('pass', `Codex ${version.display}`, `Within tested range ${TESTED_CODEX_RANGE}`),
  );

  const help = await commandRunner(resolvedCommand, ['app-server', '--help'], {
    cwd: projectRoot,
    environment,
    timeoutMs,
  });
  if (!help.ok) {
    checks.push(
      check(
        'fail',
        help.timedOut ? 'Codex App Server help timed out' : 'Codex App Server is unavailable',
        'The installed Codex CLI must provide app-server',
      ),
    );
    return { exitCode: 1, checks, resolvedCommand, codexVersion: version.display };
  }
  checks.push(check('pass', 'Codex App Server available', 'codex app-server --help succeeded'));

  const probe = await appServerProbe(resolvedCommand, {
    cwd: projectRoot,
    environment,
    timeoutMs,
    model: environment.CODESIGN_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL,
    effort: environment.CODESIGN_CODEX_EFFORT?.trim().toLowerCase() || DEFAULT_CODEX_EFFORT,
  });
  if (!probe.ok) {
    checks.push(
      check(
        'fail',
        probe.timedOut
          ? 'Codex App Server initialization timed out'
          : 'Codex App Server initialization failed',
        'Run codex app-server --help, then retry pnpm run doctor',
      ),
    );
    return { exitCode: 1, checks, resolvedCommand, codexVersion: version.display };
  }
  checks.push(check('pass', 'Codex App Server initialized', 'Read-only protocol probe succeeded'));

  if (probe.authenticated) {
    checks.push(check('pass', safeAuthLabel(probe.authMode), 'Existing Codex authentication'));
  } else {
    checks.push(
      check('fail', 'Codex is not authenticated', 'Run codex login, then retry pnpm run doctor'),
    );
  }
  if (probe.capabilitiesAvailable) {
    checks.push(
      check(
        'pass',
        'Required canvas-agent capabilities available',
        `${probe.model} with ${probe.effort} reasoning`,
      ),
    );
  } else {
    checks.push(
      check(
        'fail',
        'Required canvas-agent capabilities unavailable',
        `${probe.model} with ${probe.effort} reasoning was not advertised`,
      ),
    );
  }

  return {
    exitCode: checks.some((item) => item.blocking) ? 1 : 0,
    checks,
    resolvedCommand,
    codexVersion: version.display,
  };
}

export function formatDoctorResult(result) {
  const lines = ['Codesign doctor', ''];
  for (const item of result.checks) {
    const icon = item.kind === 'pass' ? '✓' : item.kind === 'warn' ? '⚠' : '✗';
    lines.push(`${icon} ${item.label}`);
    if (item.detail && item.kind !== 'pass') lines.push(`  ${item.detail}`);
  }

  if (result.exitCode === 0) {
    lines.push('', 'Codesign is ready.');
  } else {
    const missingCodex = result.checks.some((item) => item.label === 'Codex CLI was not found');
    if (missingCodex) {
      lines.push(
        '',
        'Install Codex separately:',
        '  npm install --global @openai/codex',
        '',
        'Then authenticate and retry:',
        '  codex login',
        '  pnpm run doctor',
      );
    } else {
      lines.push('', 'Codesign is not ready. Resolve the failed checks and retry pnpm run doctor.');
    }
  }
  return `${lines.join('\n')}\n`;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const result = await runDoctor();
  process.stdout.write(formatDoctorResult(result));
  process.exitCode = result.exitCode;
}
