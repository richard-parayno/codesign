# Malleable

Malleable is a local-first interaction prototype for moving from ambiguous greybox marks to working software. The designer draws, selects, connects, promotes, and generalizes; the agent interprets those direct manipulations as typed proposals instead of silently rewriting the canvas or acting as a dominant chat interface.

The default experience is genuinely blank. A deterministic demo checkpoint is available as a presentation fallback, and the full critical path works without a network connection, API key, usage credits, or Codex login.

## Setup on NixOS

Install [devenv](https://devenv.sh/), then run:

```sh
devenv shell -- node --version
devenv shell -- pnpm --version
devenv shell -- codex --version
devenv shell -- pnpm install
devenv shell -- pnpm dev --host 0.0.0.0
```

Open `http://localhost:5173`. `devenv.nix` pins Node 22, pnpm, git, and a Codex package. The project also pins `@openai/codex` 0.144.1 and puts its executable first on the development-shell path so the generated App Server bindings and runtime remain aligned.

## Agent backends

Copy `.env.example` to `.env` only when you want to change the default. Safe configuration:

```dotenv
MALLEABLE_AGENT_BACKEND=local
MALLEABLE_CODEX_COMMAND=codex
MALLEABLE_CODEX_MODEL=
```

- `local` is the default deterministic adapter. It uses selection, geometry, roles, and registry contracts.
- `codex` uses a long-lived `codex app-server --stdio` child process on the SvelteKit server. It reuses authentication owned by the local Codex CLI and does not use `OPENAI_API_KEY` or Platform billing.

Authenticate manually if needed:

```sh
devenv shell -- codex login
devenv shell -- codex login status
```

Malleable never reads or forwards `~/.codex/auth.json`. App Server runs read-only, without network access, with approvals disabled. Only the selected design-document slice, recent intent, registry contract, and agency envelope are sent. Responses are schema-constrained, parsed defensively, checked against stable IDs and the registry, and staged as proposals. Sign-out, timeout, crash, invalid JSON, or an invalid operation activates the local fallback and a visible diagnostic.

## Architecture

- `src/lib/model/types.ts` defines the source-of-truth document, nodes, operations, proposal, and Zod schemas.
- `src/lib/model/operations.ts` validates and deterministically reduces create, move, resize, delete, repeat, semantic bind, transition, promotion, style, generalize, duplicate-screen, and branch operations.
- `src/lib/model/store.ts` adds per-project snapshot undo/redo and versioned local project persistence.
- `src/lib/design-system/registry.ts` is the component/token allowlist shared by promotion validation and projection.
- `src/lib/model/codegen.ts` produces the read-only Svelte projection from the same document used by the canvas.
- `src/lib/agent/local.ts` provides offline interpretation.
- `src/lib/agent/codex-client.server.ts` implements JSONL JSON-RPC lifecycle, timeouts, cancellation, denial of approval requests, and streamed output for Codex App Server.
- `.generated/codex-app-server/` contains bindings generated directly by the pinned CLI.
- `src/routes/+page.svelte` is the SVG direct-manipulation editor and all inspectable UI surfaces.

The three agency envelopes are deliberately different: Protect always leaves agent operations staged for confirmation; Guide stages focused contextual proposals and is the default; Explore accepts only after creating and switching to an isolated branch.

## Editor controls

- Use the labeled **Project** picker in the left sidebar to switch local projects; **New project**, **Rename**, and **Delete** manage them
- `V` Select, `F` Frame, `R` Rectangle, `T` Text, `C` Connect
- Shift-click for multi-selection
- Drag a selected object to move it; drag the lower-right handle to resize
- Scroll or use a two-finger touchpad gesture to pan in either axis
- Pinch on a touchpad to zoom around the pointer; middle-drag remains available for mouse panning
- Right-click an object for relevant element actions, or right-click empty canvas for canvas actions
- Use **Canvas color** in the canvas toolbar to choose a solid workspace color; the preference persists locally
- Arrow keys nudge by 1 px; Shift+arrow nudges by 10 px
- Ctrl/⌘+Z undo; Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redo
- Delete/Backspace removes selected objects; Escape cancels a proposal or exits Preview

## Development action logs

While `pnpm dev` is running, meaningful browser actions are forwarded to the SvelteKit terminal as one-line JSON records prefixed with `[malleable:action]`. The stream includes labeled control clicks, project creation lifecycle events, validated operations, proposal lifecycle events, screen navigation, canvas preferences, and debounced viewport changes. Debug logging is disabled in production and does not send the full design document.

## Verification

```sh
devenv shell -- pnpm format:check
devenv shell -- pnpm check
devenv shell -- pnpm test
devenv shell -- pnpm build
```

Tests cover reducer invariants, project migration and persistence, registry rejection, branch isolation, deterministic Svelte compilation, and the App Server lifecycle through a fake JSON-RPC process. Tests never make a real Codex turn or consume credits.

## MVP limitations

The editor uses bounded axis-aligned objects rather than arbitrary vectors; hierarchy is semantic rather than a complete auto-layout engine; multi-selection resize is intentionally omitted; the projection is deterministic export, not arbitrary bidirectional source editing; projects exist only in the current browser’s local storage; App Server keeps one ephemeral thread per development server and does not yet expose thread/branch management controls. This is a local hackathon prototype, not a hosted multi-user service.

See [docs/demo-script.md](docs/demo-script.md) for the timed demo path.
