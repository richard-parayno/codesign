import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type {
  CanvasSessionCreateInput,
  CanvasSessionService as CanvasSessionServiceContract,
  CanvasToolName,
} from './contracts';

export const CANVAS_HARNESS_HELP = `Codesign canvas harness

Usage:
  npm run harness -- session create --json <json|->
  npm run harness -- scene overview --session <id> [--json <json|->]
  npm run harness -- scene get-nodes --session <id> --json <json|->
  npm run harness -- scene render --session <id> [--json <json|->]
  npm run harness -- components search --session <id> [--json <json|->]
  npm run harness -- components describe --session <id> --json <json|->
  npm run harness -- candidate state --session <id> [--json <json|->]
  npm run harness -- candidate apply --session <id> --json <json|->
  npm run harness -- candidate validate --session <id> [--json <json|->]
  npm run harness -- candidate submit --session <id> [--json <json|->]
  npm run harness -- session cancel --session <id>
  npm run harness -- script run --file <script.json>

All successful commands write one JSON object to stdout. Use --json - to read JSON from stdin.
A script is {"commands":[...]} and may use "$session" as the latest created session ID.
`;

const dispatchCommands = {
  'scene overview': 'scene.overview',
  'scene get-nodes': 'scene.get_nodes',
  'scene render': 'scene.render',
  'components search': 'components.search',
  'components describe': 'components.describe',
  'candidate state': 'candidate.get_state',
  'candidate apply': 'candidate.apply_changes',
  'candidate validate': 'candidate.validate',
  'candidate submit': 'candidate.submit',
} as const satisfies Record<string, CanvasToolName>;

export type CanvasCliCommand =
  | { command: 'session create'; input: CanvasSessionCreateInput }
  | { command: 'session cancel'; sessionId: string }
  | {
      command: keyof typeof dispatchCommands;
      sessionId: string;
      input?: unknown;
    };

export type CanvasCliScript = {
  commands: Array<
    | { command: 'session create'; input: CanvasSessionCreateInput }
    | { command: 'session cancel'; sessionId?: string }
    | {
        command: keyof typeof dispatchCommands;
        sessionId?: string;
        input?: unknown;
      }
  >;
};

export async function runCanvasCliCommand(
  service: CanvasSessionServiceContract,
  command: CanvasCliCommand,
) {
  if (command.command === 'session create') return service.createSession(command.input);
  if (command.command === 'session cancel')
    return { cancelled: await service.cancelSession(command.sessionId) };
  return service.dispatch(
    command.sessionId,
    dispatchCommands[command.command],
    command.input ?? {},
  );
}

export async function runCanvasCliScript(
  service: CanvasSessionServiceContract,
  script: CanvasCliScript,
) {
  let sessionId = '';
  let sourceInput: CanvasSessionCreateInput | undefined;
  let sourceJson = '';
  const results: unknown[] = [];

  for (const step of script.commands) {
    if (step.command === 'session create') {
      sourceInput = step.input;
      sourceJson = JSON.stringify(step.input.document);
      const result = await runCanvasCliCommand(service, step);
      if (
        !result ||
        typeof result !== 'object' ||
        typeof (result as { id?: unknown }).id !== 'string'
      )
        throw new Error('session create did not return a session ID');
      sessionId = (result as { id: string }).id;
      results.push({ command: step.command, result });
      continue;
    }
    const resolvedSessionId =
      step.sessionId === '$session' || !step.sessionId ? sessionId : step.sessionId;
    if (!resolvedSessionId) throw new Error(`${step.command} requires a session ID`);
    const result = await runCanvasCliCommand(service, {
      ...step,
      sessionId: resolvedSessionId,
    } as CanvasCliCommand);
    results.push({ command: step.command, result });
  }

  return {
    results,
    sourceUnchanged: sourceInput ? JSON.stringify(sourceInput.document) === sourceJson : null,
  };
}

type ParsedArguments = {
  command: string;
  sessionId?: string;
  json?: string;
  file?: string;
};

function parseArguments(argv: string[]): ParsedArguments {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { command: 'help' };
  const words: string[] = [];
  let sessionId: string | undefined;
  let json: string | undefined;
  let file: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--session') sessionId = argv[++index];
    else if (token === '--json') json = argv[++index];
    else if (token === '--file') file = argv[++index];
    else if (token.startsWith('--')) throw new Error(`Unknown option: ${token}`);
    else words.push(token);
  }
  return { command: words.join(' '), sessionId, json, file };
}

async function readJsonArgument(parsed: ParsedArguments, required: boolean) {
  if (parsed.file) return JSON.parse(await readFile(parsed.file, 'utf8')) as unknown;
  if (parsed.json === '-') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk.toString();
    return JSON.parse(input) as unknown;
  }
  if (parsed.json !== undefined) return JSON.parse(parsed.json) as unknown;
  if (required) throw new Error('This command requires --json <json|-> or --file <path>');
  return {};
}

export async function parseCanvasCliCommand(
  argv: string[],
): Promise<CanvasCliCommand | CanvasCliScript | 'help'> {
  const parsed = parseArguments(argv);
  if (parsed.command === 'help') return 'help';
  if (parsed.command === 'script run')
    return (await readJsonArgument(parsed, true)) as CanvasCliScript;
  if (parsed.command === 'session create') {
    return {
      command: parsed.command,
      input: (await readJsonArgument(parsed, true)) as CanvasSessionCreateInput,
    };
  }
  if (parsed.command === 'session cancel') {
    if (!parsed.sessionId) throw new Error('session cancel requires --session <id>');
    return { command: parsed.command, sessionId: parsed.sessionId };
  }
  if (!(parsed.command in dispatchCommands)) throw new Error(`Unknown command: ${parsed.command}`);
  if (!parsed.sessionId) throw new Error(`${parsed.command} requires --session <id>`);
  return {
    command: parsed.command as keyof typeof dispatchCommands,
    sessionId: parsed.sessionId,
    input: await readJsonArgument(
      parsed,
      parsed.command === 'scene get-nodes' ||
        parsed.command === 'components describe' ||
        parsed.command === 'candidate apply',
    ),
  };
}

export type CanvasCliIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runCanvasCli(
  argv: string[],
  service: CanvasSessionServiceContract,
  io: CanvasCliIo = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
) {
  try {
    const parsed = await parseCanvasCliCommand(argv);
    if (parsed === 'help') {
      io.stdout(CANVAS_HARNESS_HELP);
      return 0;
    }
    const result =
      'commands' in parsed
        ? await runCanvasCliScript(service, parsed)
        : await runCanvasCliCommand(service, parsed);
    io.stdout(JSON.stringify({ ok: true, result }));
    return 0;
  } catch (error) {
    io.stderr(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Canvas harness command failed',
      }),
    );
    return 1;
  }
}

/** Runtime entry used by scripts/codesign-harness.mjs after Vite resolves project aliases. */
export async function main(argv = process.argv.slice(2)) {
  const { CanvasSessionService } = await import('./canvas-session.server');
  const service = new CanvasSessionService();
  try {
    process.exitCode = await runCanvasCli(argv, service);
  } finally {
    await service.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
