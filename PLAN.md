# Malleable implementation plan

## Product milestone

Deliver a local-first SvelteKit prototype whose default state is a genuinely blank canvas and whose complete three-minute path remains functional without network access. Direct manipulation writes typed operations into one design document; semantic actions stage inspectable proposals before those operations are accepted.

## Architecture

- **Document core:** TypeScript `DesignDocument`, stable node IDs, Zod-validated discriminated operations, pure reducer, snapshot-backed undo/redo, and localStorage persistence.
- **Editor:** SVG canvas with pan/zoom, pointer-based draw/select/move/resize/connect, screen/layer navigation, inspector, contextual proposal bar, preview, history, and projection panels.
- **Semantic layer:** deterministic local interpreter for repeat/component proposals; Protect stages every proposal, Guide can stage contextual proposals, Explore creates changes only on a branch.
- **Component contract:** typed local registry and tokens used by promotion, validation, the canvas renderer, and deterministic Svelte projection.
- **Agent boundary:** SvelteKit server endpoint selects the local adapter or a long-lived Codex App Server transport. Codex output is parsed into the same Zod proposal schema and never mutates the document directly. Failures degrade to the local adapter.

## Implementation order

1. [x] Inspect repository and current toolchain.
2. [x] Scaffold SvelteKit, document model, operations, local persistence, and tests.
3. [x] Build blank canvas drawing, selection, transforms, Repeat proposal, acceptance, and undo/redo.
4. [x] Add screens/transitions/Preview, promotion, style generalization, and branching.
5. [x] Add inspector, history, deterministic Svelte projection, and seeded fallback.
6. [x] Add local/Codex adapters, safe status handling, timeout/cancellation, validation, and fake-transport tests.
7. [x] Polish keyboard/focus/error states and verify the full demo path in a browser.
8. [x] Run format, check, tests, build; review the final diff and documentation.

## Risks and mitigations

- **Codex CLI packaging/protocol drift:** the initial devenv shell has no `codex`. Pin `@openai/codex` as a dev dependency, expose `node_modules/.bin`, and generate/inspect schemas from the installed version. Keep the default deterministic adapter.
- **Pointer interaction breadth:** prioritize rectangle/frame creation, selection, move, resize, connect, and reliable undo over advanced vector behavior.
- **Projection validity:** keep generation deliberately small and parser-test the emitted Svelte rather than claiming arbitrary round-trip editing.
- **Demo reliability:** blank remains default; a labeled deterministic checkpoint can load the complete flow immediately.

## Explicit non-goals

No arbitrary vector paths, multiplayer, cloud storage, production auth/deployment, reference ingestion, arbitrary code editing, or autonomous shell/filesystem access from the design agent.

## Verification checklist

- `devenv shell -- pnpm format:check`
- `devenv shell -- pnpm check`
- `devenv shell -- pnpm test`
- `devenv shell -- pnpm build`
- Browser smoke pass at 1440×900: blank/reset, draw, multi-select, repeat, undo/redo, duplicate/connect/preview, promote, generalize, inspector, projection, branch, reload persistence, deterministic checkpoint.

## Final status

All milestones are complete for the MVP. Browser QA passed at 1440×900 and 1280×800 with no reproducible application or console errors. The real Codex CLI path is packaged and authenticated on this workstation; one live read-only component-match turn returned and applied a registered `DataRow` proposal. Automated tests use only the fake JSON-RPC transport and deterministic adapter, so routine verification consumes no agent turns.
