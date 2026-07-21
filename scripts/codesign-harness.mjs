import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();

function sourcePath(path) {
  const candidates = [
    path,
    `${path}.ts`,
    `${path}.js`,
    path.endsWith('.js') ? `${path.slice(0, -3)}.ts` : '',
    resolve(path, 'index.ts'),
    resolve(path, 'index.js'),
  ];
  return candidates.find(
    (candidate) => candidate && existsSync(candidate) && statSync(candidate).isFile(),
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;
    if (specifier === '$lib' || specifier.startsWith('$lib/'))
      candidate = resolve(root, 'src/lib', specifier.slice('$lib'.length + 1));
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:'))
      candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    else return nextResolve(specifier, context);

    const source = sourcePath(candidate);
    return source
      ? { url: pathToFileURL(source).href, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
    const fileName = fileURLToPath(url);
    const source = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    }).outputText;
    return { format: 'module', source, shortCircuit: true };
  },
});

const cli = await import(pathToFileURL(resolve(root, 'src/lib/agent/harness/cli.ts')).href);
await cli.main(process.argv.slice(2));
