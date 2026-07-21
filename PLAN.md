# Malleable implementation plan

## Product milestone

Deliver a local-first SvelteKit prototype whose default state is a genuinely blank canvas and whose complete three-minute path remains functional without network access. Direct manipulation writes typed operations into one design document; semantic actions stage inspectable proposals before those operations are accepted.

## Architecture

- **Document core:** TypeScript `DesignDocument`, stable node IDs, Zod-validated discriminated operations, pure reducer, snapshot-backed undo/redo, and localStorage persistence.
- **Editor:** SVG canvas with pan/zoom, pointer-based draw/select/move/resize/connect, screen/layer navigation, inspector, contextual proposal bar, preview, history, and projection panels.
- **Semantic layer:** validated structured operations for repeat/component proposals; Protect stages every proposal, Guide can stage contextual proposals, Explore creates changes only on a branch.
- **Component contract:** canonical typed shadcn-svelte manifest used by validation, the canvas renderer, the AI schema, Assets, and real Svelte projection.
- **Agent boundary:** SvelteKit server endpoint uses Codex App Server only. Codex output is parsed into the Zod candidate schema and never mutates the document directly. Provider failures leave the source unchanged.

## Implementation order

1. [x] Inspect repository and current toolchain.
2. [x] Scaffold SvelteKit, document model, operations, local persistence, and tests.
3. [x] Build blank canvas drawing, selection, transforms, Repeat proposal, acceptance, and undo/redo.
4. [x] Add screens/transitions/Preview, promotion, style generalization, and branching.
5. [x] Add inspector, history, real shadcn-aware Svelte projection, and predefined test fixtures.
6. [x] Add Codex App Server transport, safe status handling, timeout/cancellation, validation, and fake-transport tests.
7. [x] Polish keyboard/focus/error states and verify the full demo path in a browser.
8. [x] Run format, check, tests, build; review the final diff and documentation.

## Risks and mitigations

- **Codex CLI packaging/protocol drift:** pin `@openai/codex` as a dev dependency, expose `node_modules/.bin`, and generate/inspect schemas from the installed version.
- **Pointer interaction breadth:** prioritize rectangle/frame creation, selection, move, resize, connect, and reliable undo over advanced vector behavior.
- **Projection validity:** keep generation deliberately small and parser-test the emitted Svelte rather than claiming arbitrary round-trip editing.
- **Demo reliability:** blank remains default; a labeled checkpoint can load a representative editable scene immediately. It never substitutes for live generation.

## Explicit non-goals

No arbitrary vector paths, multiplayer, cloud storage, production auth/deployment, reference ingestion, arbitrary code editing, or autonomous shell/filesystem access from the design agent.

## Verification checklist

- `devenv shell -- pnpm format:check`
- `devenv shell -- pnpm check`
- `devenv shell -- pnpm test`
- `devenv shell -- pnpm build`
- Browser smoke pass at 1440×900: blank/reset, draw, Assets insertion, nested component Layers, inline generation controls, preview, inspector, projection, branch, and reload persistence.

## Final status

The App Server path is packaged and status-visible. Automated tests use predefined candidate fixtures and fake JSON-RPC transport, so routine verification consumes no Codex credits. Product generation never falls back to fabricated output.
