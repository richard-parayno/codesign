import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export async function GET() {
  const backend = env.CODESIGN_AGENT_BACKEND ?? env.MALLEABLE_AGENT_BACKEND ?? 'local';
  const command = env.CODESIGN_CODEX_COMMAND ?? env.MALLEABLE_CODEX_COMMAND ?? 'codex';
  if (backend !== 'codex')
    return json({
      backend: 'local',
      available: true,
      supportedActions: ['complete'],
      message: 'Local deterministic visual completion ready',
    });
  try {
    await run(command, ['login', 'status'], {
      timeout: 4_000,
      env: process.env,
    });
    return json({
      backend: 'codex',
      available: true,
      supportedActions: ['complete'],
      message: 'Codex CLI signed in through ChatGPT',
    });
  } catch {
    return json({
      backend: 'codex',
      available: false,
      supportedActions: ['complete'],
      message:
        'Codex is unavailable or signed out. Run devenv shell -- codex login; local fallback remains available.',
    });
  }
}
