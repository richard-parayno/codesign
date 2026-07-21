# Codesign

**Codesign is visual autocomplete for interface design.** It helps interface designers, design engineers, and product teams turn rough canvas intent into editable UI without surrendering control to an opaque prompt-to-page generator.

Prompt-to-UI tools tend to jump straight to a finished result. The output may look polished, but it is often difficult to understand, revise, or combine with the designer's existing work. Codesign keeps the designer's selection, context boundary, candidate changes, and final decision explicit.

> Prototype status: Codesign is an active local-first hackathon prototype, not a hosted or production-ready design tool.

## How it works

1. Sketch an interface with frames, groups, text, and primitive layers, or select existing work. A Codesign target must be a group or frame, or a layer contained by one.
2. Open **Codesign with AI**, choose **AI Draft** or **AI Hi-Fi**, and confirm generation. **Base** is the live canvas and never starts generation.
3. Choose an observation scope:
   - **Selection** lets Codex inspect the selected layer and its children.
   - **Same parent frame** also lets Codex consider the other layers in the shared containing frame.
     In both cases, only the explicit mutation target may change.
4. Codesign starts the separately installed Codex CLI in App Server mode and runs GPT-5.6. Codex uses canvas-native tools to inspect the scene, discover compatible components, render source or candidate views when useful, apply atomic changes to a copy-on-write candidate, validate it, and submit it for review.
5. The suggestion appears as native, editable canvas layers. **AI Draft** fills in structure with primitives; **AI Hi-Fi** can use compatible checked-in shadcn-svelte components and creates or refreshes a reusable local component definition when accepted.
6. Accept all changes, accept a dependency-safe subset, reject the candidate, reroll the same fidelity, compare with the starting canvas, or continue editing. **Element History** keeps prior variations available.

Selection and slider movement alone do not run AI or mutate the canvas.

## How Codex and GPT-5.6 power Codesign

Codesign uses Codex and GPT-5.6 in two distinct ways: they power the product's visual-autocomplete loop at runtime, and they were active collaborators in building and refining the prototype itself.

### Inside the product

- **Codex is the agent runtime.** Codesign starts the user's separately installed `codex app-server` process and communicates with it over JSON-RPC. The project does not bundle Codex or handle its credentials.
- **GPT-5.6 is the reasoning model.** It interprets the selected layers, their names and text, the chosen observation scope, the requested fidelity, and the available component catalog.
- **Canvas-native tools keep the work grounded.** The agent can inspect scene structure, read relevant nodes, discover and describe compatible shadcn-svelte components, render source or candidate views, and propose atomic canvas operations.
- **Candidates are isolated and validated.** Proposed operations run against a copy-on-write candidate rather than the live document. Codesign checks scope, hierarchy, component bindings, and operation dependencies before the candidate can be submitted for review.
- **The designer remains the decision-maker.** GPT-5.6 cannot silently overwrite the canvas. The designer reviews native editable layers and chooses whether to accept all, accept a safe subset, reject, or reroll.

This is intentionally different from asking a model to return a finished screenshot or a block of generated UI code. Codex works through the same structured scene model the editor uses, so its suggestions remain inspectable and editable.

### During development

Codex and GPT-5.6 were also used throughout the engineering process—not just embedded as a demo feature. They helped inspect and evolve the scene graph, candidate protocol, App Server integration, component-discovery flow, interaction design, tests, documentation, and local setup. The project was repeatedly dogfooded by using Codex to diagnose real editor sessions and logs, implement scoped changes, run verification, and review regressions.

The checked-in [prompts](prompts/) and [design documentation](docs/) preserve the product decisions and agent contracts that came out of that collaboration. The result is both a Codex-powered design tool and an example of using Codex to build a tool around a new human-AI interaction model.

## Five-minute quickstart

### Prerequisites

- macOS or Linux. Windows is not part of the currently tested prototype path.
- Node.js 22.x.
- Corepack and pnpm 10.15.0 (the version declared in `package.json`).
- A separately installed Codex CLI compatible with the currently tested 0.144.x line.
- A Codex account authenticated through ChatGPT or another Codex-supported sign-in method.

Install Codex separately; it is deliberately not a Codesign dependency:

```sh
npm install --global @openai/codex
codex login
```

See OpenAI's [Codex CLI quickstart](https://developers.openai.com/codex/cli/) and [authentication guide](https://developers.openai.com/codex/auth/) for the current installation and sign-in options.

Then clone and start Codesign:

```sh
git clone https://github.com/richard-parayno/codesign.git
cd codesign
corepack enable
pnpm install --frozen-lockfile
pnpm run doctor
pnpm dev --open
```

`pnpm run doctor` is a read-only preflight. It checks Node and pnpm expectations, finds the Codex executable, verifies the CLI and App Server compatibility, initializes App Server far enough to inspect the required capabilities and authentication status, and exits without starting a login flow or making an AI generation request. The explicit `run` is required because pnpm 10 already reserves `pnpm doctor` for its own unrelated package-manager diagnostic.

If Codex is missing, authentication is unavailable, or a compatibility check fails, the editor still starts and remains explorable; only AI completion is unavailable. Resolve the reported issue and rerun `pnpm run doctor`.

## Bring your own Codex

Codesign owns the editor and local App Server integration. You own the Codex installation and authentication.

- The project does not bundle, download, or install the Codex CLI.
- The local SvelteKit server starts `codex app-server` directly with argument-safe process spawning, not through a shell.
- App Server reuses the normal authentication state managed by Codex.
- Codesign does not read, copy, or forward Codex credential files.
- The generated TypeScript protocol bindings under `.generated/codex-app-server/` are checked-in compile-time contracts; they do not provide or require a Codex runtime.

By default the server resolves the bare command `codex` through its process `PATH`. If Codex is installed somewhere that is not on that `PATH`, export the override before running the preflight, and add the same value to a local `.env` for the development server:

```sh
export CODESIGN_CODEX_COMMAND=/absolute/path/to/codex
pnpm run doctor
```

```dotenv
CODESIGN_CODEX_COMMAND=/absolute/path/to/codex
```

Quote a `.env` value that contains spaces. In a shell, quote the value according to that shell's syntax:

```dotenv
CODESIGN_CODEX_COMMAND="/absolute/path with spaces/codex"
```

All supported overrides are optional:

```dotenv
# Defaults shown below
CODESIGN_CODEX_MODEL=gpt-5.6-luna
CODESIGN_CODEX_EFFORT=high
CODESIGN_AGENT_TIMEOUT_MS=180000
```

`CODESIGN_AGENT_TIMEOUT_MS` accepts 1,000 through 600,000 milliseconds. Local `.env` files are ignored by Git and should not contain Codex credentials or API keys.

## Architecture

- **Editor:** SvelteKit, Svelte 5, Vite, and an SVG direct-manipulation canvas. Projects, revisions, candidates, decisions, fidelity metadata, and reusable local components persist in browser storage.
- **Document model:** `src/lib/model/` defines the versioned scene graph, validates atomic operations and transactions, stages copy-on-write candidates, and applies dependency-safe acceptance decisions.
- **Codesign host:** server routes under `src/routes/api/agent/` validate generation requests, report provider status, manage cancellation, and create an isolated canvas session for each request.
- **Codex transport:** `src/lib/agent/codex-client.server.ts` speaks JSON-RPC over stdio to the user-installed `codex app-server`. Checked-in bindings in `.generated/codex-app-server/` keep the TypeScript integration aligned with the tested protocol.
- **Canvas agent tools:** `src/lib/agent/harness/` exposes bounded tools for scene overview and node inspection, source/candidate rendering, shadcn-svelte component search and description, candidate state, atomic changes, validation, and submission.
- **Review UI:** `src/lib/codesign/` and `src/routes/+page.svelte` present scope and fidelity controls, candidate review, partial acceptance, rerolls, source comparison, local components, and process history.

At runtime GPT-5.6 operates only through the local Codex App Server and its scoped canvas tools.

## Development and verification

Run the full repository verification pipeline:

```sh
pnpm verify
```

Or run the checks separately:

```sh
pnpm format:check
pnpm check
pnpm test
pnpm build
```

The automated test suite uses fake transports and fixtures; it does not depend on a developer's real Codex installation, authentication state, or credits.

During `pnpm dev`, meaningful browser actions and Codesign activity are logged as concise JSON records in the SvelteKit terminal. Production builds do not enable the development action stream.

## Optional devenv / NixOS setup

The standard Node/pnpm quickstart above is the primary setup path. Contributors who already use [devenv](https://devenv.sh/) can instead enter the checked-in Node 22 and pnpm environment:

```sh
devenv shell
pnpm run doctor
pnpm dev --open
```

The devenv shell intentionally does not install Codex. Install and authenticate the CLI separately, then make sure `codex` is on the shell's `PATH` or set `CODESIGN_CODEX_COMMAND`.

## Local server security

`pnpm dev` uses Vite's loopback-only development-server default. Codesign can control a locally authenticated Codex process, so do not run it with `--host 0.0.0.0` or expose it to a LAN, tunnel, container ingress, or public interface. Advanced users can deliberately override the host, but they are responsible for adding an appropriate trusted access boundary.

## Current limitations

- The setup and Codex compatibility path is currently tested against Node 22, pnpm 10.15.0, and Codex CLI 0.144.x on Linux; macOS is a supported target but should receive additional clean-machine coverage.
- Projects are stored in the browser rather than synchronized to a backend.
- App Server sessions are ephemeral and scoped to the local development server.
- The canvas uses bounded, axis-aligned objects and the current AI action is visual autocomplete at AI Draft or AI Hi-Fi fidelity—not production code round-tripping.
- AI Hi-Fi component generation is limited to compatible entries in the checked-in shadcn-svelte manifest; unsupported compositions remain editable canvas layers.
- This repository does not currently include a license file.

## Demo

- Public demo video: _coming soon_
- Screenshots: _coming soon_

For the current walkthrough, see [docs/demo-script.md](docs/demo-script.md). For design and migration context, see [docs/new-interaction-plan.md](docs/new-interaction-plan.md) and [docs/inline-ai-shadcn-migration.md](docs/inline-ai-shadcn-migration.md).
