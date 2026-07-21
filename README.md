# Codesign

Codesign is a local-first visual-autocomplete prototype. You draw and manipulate a design directly, select the exact layers that may change, choose how much surrounding context the generator may reference, and explicitly request a structured candidate. Selection alone never generates or mutates the canvas.

Candidates are native scene-graph changes rather than screenshots. They remain ghosted above the source until you accept all changes or a dependency-safe subset. Rejected candidates, rerolls, source comparisons, and decisions remain in process history.

## Setup on NixOS

```sh
devenv shell -- pnpm install
devenv shell -- pnpm dev --host 0.0.0.0
```

Open `http://localhost:5173`. `devenv.nix` pins Node 22, pnpm, git, and the Codex package used by the checked-in App Server bindings.

## Codesign AI

Codex App Server is the only generation path. Codesign never fabricates a candidate when the runtime is unavailable or the user is signed out.

```dotenv
CODESIGN_CODEX_MODEL=gpt-5.6-luna
CODESIGN_CODEX_EFFORT=high
```

Codesign uses the project-pinned Codex App Server and the user's existing ChatGPT/Codex login. If needed, use the visible **Sign in to Codex** action; App Server owns the official browser login, token persistence, and refresh. `CODESIGN_CODEX_COMMAND` remains an advanced explicit runtime override.

Codesign never reads or forwards `~/.codex/auth.json`. App Server runs read-only with approvals disabled. Each generation gets an isolated ephemeral thread with `gpt-5.6-luna`, high reasoning effort, and no reasoning summary. Codesign supplies a clean raster of the observation root together with a versioned structured scene manifest. Browser image bytes are validated, hashed, written to a process-owned temporary file, and removed after the turn. Output is schema-constrained and semantically revalidated before it can be staged. Provider failures are shown directly and leave the source design unchanged.

## Core flow

1. Draw a frame or click **Load demo checkpoint**.
2. Select the frame or exact layers Codesign may change.
3. Choose **Scope** beside the selection, then pick **Selection**, **Parent**, **Containing frame**, or **Screen**. The lighter dashed boundary is observational only; the solid boundary marks what may change.
4. Choose **Complete with Codesign** or press Ctrl/⌘+Enter. Nothing on the source canvas changes while generation runs; use **Cancel** to stop a request.
5. Switch candidates, highlight evidence, inspect each derivation trace, compare with the source, and select atomic changes.
6. **Accept all**, accept a dependency-safe subset, **Reject**, or pin a proposed change and **Reroll**.
7. Open **Process history** to revisit rejected candidates, source comparisons, decisions, and replayable changes.

Only **Complete with Codesign** is exposed because it is the action implemented end to end. The shared request vocabulary also reserves Refine, Vary, and Resolve; the UI does not present them as dead controls.

## Editor controls

- Use the labeled **Project** picker to switch local files; **New project**, **Rename**, and **Delete** manage them.
- `V` Select, `F` Frame, `R` Rectangle, `T` Text.
- Shift-click for multi-selection.
- Drag selected objects to move them; drag the lower-right handle to resize.
- Scroll or two-finger drag to pan. Pinch to zoom around the pointer. Middle-drag also pans.
- Right-click an object or empty canvas for a relevant text-labelled context menu.
- **Canvas color** changes the solid workspace background and persists locally.
- **Settings** manages canvas appearance, viewport recovery, new-frame defaults, local project diagnostics, and the Codesign AI integration. Fidelity is controlled from the selected frame or element in the editor. Model and reasoning-effort choices persist in this browser and apply to new generations and rerolls.
- Arrow keys nudge by 1 px; Shift+arrow nudges by 10 px.
- Ctrl/⌘+Z undo; Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redo.
- Delete/Backspace removes selected objects; Escape exits Preview or dismisses contextual UI.

## Architecture

- `src/lib/model/types.ts` defines the v2 document, stable entities/representations, revisions, generation runs, candidates, atomic changes, and process events.
- `src/lib/model/operations.ts` validates direct operations and transactional operation batches.
- `src/lib/model/codesign.ts` stages, views, rejects, compares, accepts, rerolls, replays, pins, and resolves fidelity inheritance.
- `src/lib/model/migration.ts` recoverably imports v1 documents while retaining the legacy source.
- `src/lib/model/store.ts` provides per-project undo/redo and versioned v2 local persistence.
- `src/lib/agent/codex-client.server.ts` provides the constrained App Server transport.
- `src/lib/codesign/` contains the inline candidate, component-library, fidelity, and process-history surfaces.
- `src/routes/+page.svelte` remains the direct-manipulation SVG canvas and page controller.

## Development action logs

During `pnpm dev`, meaningful browser actions appear in the SvelteKit terminal as one-line JSON records prefixed with `[codesign:action]`. The stream includes labelled controls, project lifecycle events, direct operations, Co-design request/candidate/decision events, navigation, canvas preferences, and debounced viewport changes. Logging is disabled in production and never sends the full design document.

## Verification

```sh
devenv shell -- pnpm format:check
devenv shell -- pnpm check
devenv shell -- pnpm test
devenv shell -- pnpm build
```

Fixture and fake-transport tests do not make real Codex turns or consume credits.

## Current limitations

The canvas uses bounded axis-aligned objects; projects remain in browser local storage; and the Codex transport keeps an ephemeral thread per development server. Simple shadcn controls and validated Card, Alert, Avatar, Table, Tabs, Dialog, Sheet, Select, Dropdown Menu, and Navigation Menu compositions mount the real checked-in source. Context-heavy or headless entries without a validated default tree remain visible, editable manifest-backed fallbacks rather than mounting invalid standalone parts. Legacy v1 operations remain readable and migratable, but old intent hypotheses are archived rather than treated as evidence.

See [docs/demo-script.md](docs/demo-script.md) for the demo path and [docs/new-interaction-plan.md](docs/new-interaction-plan.md) for the migration decisions.
