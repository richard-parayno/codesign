import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export async function GET() {
  if ((env.MALLEABLE_AGENT_BACKEND ?? 'local') !== 'codex')
    return json({ backend: 'local', available: true, message: 'Local deterministic rules ready' });
  try {
    await run(env.MALLEABLE_CODEX_COMMAND || 'codex', ['login', 'status'], {
      timeout: 4_000,
      env: process.env,
    });
    return json({
      backend: 'codex',
      available: true,
      message: 'Codex CLI signed in through ChatGPT',
    });
  } catch {
    return json({
      backend: 'codex',
      available: false,
      message:
        'Codex is unavailable or signed out. Run devenv shell -- codex login; local fallback remains available.',
    });
  }
}
