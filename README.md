# Codesign

Codesign is a local-first visual-autocomplete prototype. You draw and manipulate a design directly, select the exact layers that may change, choose how much surrounding context the generator may reference, and explicitly request a structured candidate. Selection and entering Co-design never generate or mutate the canvas.

Candidates are native scene-graph changes rather than screenshots. They remain ghosted above the source until you accept all changes or a dependency-safe subset. Rejected candidates, rerolls, source comparisons, and decisions remain in process history.

## Setup on NixOS

```sh
devenv shell -- pnpm install
devenv shell -- pnpm dev --host 0.0.0.0
```

Open `http://localhost:5173`. `devenv.nix` pins Node 22, pnpm, git, and the Codex package used by the checked-in App Server bindings.

## Generator backends

Codex App Server is the configured real-AI path. The deterministic local provider remains available for offline development and supports the complete review flow without an API key, credits, or a Codex login.

```dotenv
CODESIGN_AGENT_BACKEND=codex
CODESIGN_CODEX_MODEL=gpt-5.6-luna
CODESIGN_CODEX_EFFORT=high
# Optional and always visibly labelled when used:
CODESIGN_ALLOW_LOCAL_FALLBACK=false
```

The older `MALLEABLE_*` names remain accepted during migration. For the real AI path, set `CODESIGN_AGENT_BACKEND=codex`. Codesign uses the project-pinned Codex App Server and the user's existing ChatGPT/Codex login. If needed, use the visible **Sign in to Codex** action; App Server owns the official browser login, token persistence, and refresh. `CODESIGN_CODEX_COMMAND` remains an advanced explicit runtime override.

Codesign never reads or forwards `~/.codex/auth.json`. App Server runs read-only with approvals disabled. Each generation gets an isolated ephemeral thread with `gpt-5.6-luna`, high reasoning effort, and no reasoning summary. Codesign supplies a clean raster of the observation root together with a versioned structured scene manifest. Browser image bytes are validated, hashed, written to a process-owned temporary file, and removed after the turn. Output is schema-constrained and semantically revalidated before it can be staged. Provider failures are shown directly; local fallback only occurs when `CODESIGN_ALLOW_LOCAL_FALLBACK=true` and is recorded and visibly labelled.

## Core flow

1. Draw a frame or click **Load demo checkpoint**.
2. Select the frame or exact layers Codesign may change.
3. Enter **Co-design**. Confirm the solid **Can change** boundary.
4. Choose **Selection**, **Parent**, **Containing frame**, or **Screen** under **Can reference**. The lighter dashed boundary is observational only.
5. Choose **Complete with Codesign** or press Ctrl/⌘+Enter. Nothing on the source canvas changes while generation runs; use **Cancel generation** to stop a request.
6. Switch candidates, highlight evidence, inspect each derivation trace, compare with the source, and select atomic changes.
7. **Accept all**, accept a dependency-safe subset, **Reject candidate**, or pin a proposed change and **Reroll unpinned changes**.
8. Open **Process history** to revisit rejected candidates, source comparisons, decisions, and replayable changes.

Only **Complete with Codesign** is exposed because it is the action implemented end to end. The shared request vocabulary also reserves Refine, Vary, and Resolve; the UI does not present them as dead controls.

## Editor controls

- Use the labeled **Project** picker to switch local files; **New project**, **Rename**, and **Delete** manage them.
- `V` Select, `F` Frame, `R` Rectangle, `T` Text, `C` Connect.
- Shift-click for multi-selection.
- Drag selected objects to move them; drag the lower-right handle to resize.
- Scroll or two-finger drag to pan. Pinch to zoom around the pointer. Middle-drag also pans.
- Right-click an object or empty canvas for a relevant text-labelled context menu.
- **Canvas color** changes the solid workspace background and persists locally.
- **Settings** manages canvas appearance, viewport recovery, new-frame defaults, Co-design fidelity, local project diagnostics, and the Codesign AI integration. Model and reasoning-effort choices persist in this browser and apply to new generations and rerolls.
- Arrow keys nudge by 1 px; Shift+arrow nudges by 10 px.
- Ctrl/⌘+Z undo; Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redo.
- Delete/Backspace removes selected objects; Escape exits Preview or Co-design.

## Architecture

- `src/lib/model/types.ts` defines the v2 document, stable entities/representations, revisions, generation runs, candidates, atomic changes, and process events.
- `src/lib/model/operations.ts` validates direct operations and transactional operation batches.
- `src/lib/model/codesign.ts` stages, views, rejects, compares, accepts, rerolls, replays, pins, and resolves fidelity inheritance.
- `src/lib/model/migration.ts` recoverably imports v1 documents while retaining the legacy source.
- `src/lib/model/store.ts` provides per-project undo/redo and versioned v2 local persistence.
- `src/lib/agent/local.ts` produces deterministic structured candidates.
- `src/lib/agent/codex-client.server.ts` provides the constrained App Server transport.
- `src/lib/codesign/` contains the accessible Co-design, fidelity, and process-history surfaces.
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

Deterministic and fake-transport tests do not make real Codex turns or consume credits.

## Current limitations

The canvas uses bounded axis-aligned objects; visual/production fidelity generation is not implemented; browser canvas raster capture and trusted snapshot storage are deferred; projects remain in browser local storage; and the Codex transport keeps an ephemeral thread per development server. Legacy v1 operations remain readable and migratable, but old intent hypotheses are archived rather than treated as evidence.

See [docs/demo-script.md](docs/demo-script.md) for the demo path and [docs/new-interaction-plan.md](docs/new-interaction-plan.md) for the migration decisions.
