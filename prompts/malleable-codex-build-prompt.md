# Codex build prompt: Malleable

You are the lead product engineer and interaction prototyper for **Malleable**, an OpenAI Build Week hackathon project. Work in the current repository and deliver a functioning, polished prototype—not only an architecture document or static mockup.

First inspect the repository, its `AGENTS.md` files, current git state, and any existing implementation. Preserve unrelated user work and adapt this brief to what already exists. Then create a concise living plan in `PLAN.md`, including milestones, architecture, risks, and verification. After writing the plan, begin implementation immediately and carry it through to a tested prototype. Update the plan as you work. Ask the user only if a truly blocking choice would materially change the product; otherwise state reasonable assumptions and proceed.

## Product thesis

Malleable explores a new interface for AI-native design work:

> Let designers move from ambiguous marks to working software by progressively manipulating what their decisions mean.

The central interaction is **not prompting an AI to design a screen**. The designer draws, groups, resizes, duplicates, connects, and refines objects. Malleable interprets those actions as tentative design intent, lets the designer confirm or correct that interpretation, and then uses an agent to realize selected intent in real components and code.

The shortest version is:

> Design the screen; let AI understand what the moves mean.

This is specifically a blank-canvas/original-work workflow. Moodboards and references may become useful later, but the MVP must provide value without any reference image, source site, or initial prompt.

## Problem being addressed

Current AI design workflows commonly fail in three ways:

1. A designer repeatedly prompts a coding agent, waits, reacts to a large result, and occasionally edits code. This produces working UI but weakens the continuous mind–hand–surface feedback loop and the designer’s local agency.
2. Generators often invent new components or arbitrary styles instead of using the product’s existing design system. Natural-language intent is translated into unconstrained latent choices.
3. People without design vocabulary or developed taste struggle to ask for “good design.” Much of their useful input exists in actions, comparisons, partial arrangements, and examples—not polished verbal prompts.

Malleable should demonstrate that an AI agent can sit behind a direct-manipulation surface and operate on a structured design document under explicit constraints. Chat may exist as a secondary escape hatch, but it must not be the main interaction or dominate the UI.

## The interaction model

The prototype should make five verbs tangible:

- **Sketch** — make rough spatial marks quickly.
- **Bind** — give marks semantic roles or relationships.
- **Generalize** — turn a manual edit or repeated arrangement into a reusable rule.
- **Promote** — resolve an ambiguous greybox region into registered design-system components.
- **Branch** — explore an alternative without destroying the current direction.

“Sample from a reference” is intentionally out of scope for the critical path.

Design intent is progressively committed rather than fully specified up front. A grey rectangle can move through states like:

`unnamed area → content region → repeated records → table → registered DataTable → compact DataTable bound to data`

Each step should remain visible, inspectable, reversible, and attributable to either the user or the agent.

## Required three-minute demo path

Optimize all product and engineering decisions around making this sequence fast, legible, and reliable:

1. Open a genuinely empty canvas.
2. Draw a rough SaaS interface: an app frame, sidebar, header, main content region, and several repeated row/card shapes.
3. Select repeated shapes. Malleable proposes “Repeat?” as a low-friction contextual affordance; confirm it to create a semantic repeater.
4. Duplicate the screen or create a second state. Connect a row to a details state or side panel, then enter Preview and click through the greybox interaction.
5. Select the shell or a region and choose **Promote**. Malleable maps semantic roles only to components in the included design-system registry. The screen may intentionally contain a mixture of rough and promoted regions.
6. Directly adjust one promoted card or row—for example padding, density, border radius, or action placement. Choose **Generalize** and select an explicit scope such as siblings in this repeater. Show the rule propagating.
7. Open the intent/structure inspector and show what is confirmed, inferred, still ambiguous, and protected.
8. Open the code projection and operation history. Show valid Svelte code that imports registered components, plus the user/agent provenance of the changes.
9. Branch the current screen and try one alternative without changing the original.

Provide a one-click “Reset to blank” action. Also provide a clearly labeled deterministic demo checkpoint/seed as a presentation fallback, while keeping the default experience blank.

## UX requirements

Build a real direct-manipulation editor, not a static illustration of one.

At minimum, support:

- a large canvas with pan and zoom;
- tools for Select, Frame, Rectangle, Text, and Connect;
- click-drag creation of frames and rectangles;
- object selection, multi-selection, movement, and resizing;
- a simple layer or screen list;
- duplicate screen/state;
- undo and redo through an operation history;
- contextual suggestions attached to the current selection rather than emitted as chat messages;
- semantic actions for Repeat, Bind role, Promote, Generalize, and Branch;
- a lightweight playable Preview mode for screen/state transitions;
- an inspector showing geometry, style, semantic role, component binding, provenance, and confidence/commitment state;
- a code panel showing a valid Svelte projection derived from the same design document;
- local persistence so a refresh does not destroy the current document.

Prefer keyboard shortcuts for the main tools and undo/redo, but do not hide critical actions behind shortcuts. Include useful empty, selected, loading, error, Codex-not-signed-in, and local-fallback states.

Use an editor-like desktop layout suitable for a 1440×900 demo:

- left: tools plus screens/layers;
- center: canvas and contextual interaction;
- right: intent and properties inspector;
- bottom or collapsible panel: operation history, agent proposals, and code projection.

The interface should feel precise, quiet, and professional. Avoid a generic chatbot layout, oversized marketing copy, gratuitous gradients, or a UI made mostly of rounded cards. Use a coherent token set, strong hierarchy, restrained motion, visible focus states, and good contrast. Mixed fidelity is a feature: greybox regions and resolved components should coexist without looking broken.

## Agency model

Include a small control for three agent envelopes:

- **Protect** — the agent may inspect and propose, but every change requires confirmation.
- **Guide** — the default; contextual low-risk proposals are staged and can be accepted locally.
- **Explore** — broader proposals are allowed, but they must be applied to a branch rather than silently changing the accepted design.

Do not let the model mutate the document directly. Every AI-produced change must become a typed, schema-validated proposed operation. The UI must show its target, scope, rationale, and resulting change before or as it is accepted according to the current envelope. No unexplained large rewrites.

## Design document and operation model

Use a small, typed intermediate representation as the source of truth. Adjust exact types as implementation requires, but preserve these concepts:

```ts
type DesignDocument = {
  screens: Screen[];
  nodes: Record<NodeId, DesignNode>;
  transitions: Transition[];
  branches: Branch[];
  activeBranchId: string;
  hypotheses: IntentHypothesis[];
  operations: DesignOperation[];
};

type DesignNode = {
  id: string;
  kind: 'frame' | 'rectangle' | 'text' | 'group' | 'instance';
  parentId?: string;
  childIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
  style: StyleProperties;
  semantics?: { role: string; commitment: 'ambiguous' | 'inferred' | 'confirmed' };
  componentBinding?: { componentId: string; props: Record<string, unknown> };
  provenance: { actor: 'user' | 'agent'; operationId: string };
};

type IntentHypothesis = {
  id: string;
  targetIds: string[];
  kind: 'repetition' | 'hierarchy' | 'navigation' | 'state' | 'component-match';
  confidence: number;
  status: 'proposed' | 'accepted' | 'rejected';
  evidence: string[];
};
```

Implement document changes through a discriminated union of operations with an inverse or another robust undo strategy. Operations should cover at least create, move, resize, delete, group/repeat, bind semantics, add transition, promote, change style, generalize, and create branch.

The model is allowed to propose operations only against existing stable IDs. Validate IDs, operation shape, scope, component names, and token values before staging or applying anything. Keep rendering, selection, transforms, history, and code projection deterministic.

## Design-agent harness

Implement a narrow design-specific harness rather than giving the model arbitrary source-code or filesystem authority inside the product.

Create an interface with two adapters:

1. **Local deterministic adapter** — always available, uses geometry, selection, recent user operations, and simple rules to propose repetition, hierarchy, and component matches. This keeps the core demo fully functional with no network, account login, or usage credits.
2. **Codex App Server adapter** — the primary real-agent path for this local hackathon prototype. It must use the locally installed Codex CLI authenticated through `codex login` with the developer’s ChatGPT/Codex account. It must not require or assume OpenAI Platform API credits or an `OPENAI_API_KEY`.

Implement the Codex adapter on the SvelteKit server only. Spawn a pinned, verified `codex app-server` child process using its local stdio transport and communicate over its JSON-RPC/JSONL protocol. Never launch it from browser code or expose its raw transport to the client. Follow the protocol supported by the installed Codex version: initialize the connection, acknowledge initialization, create or resume a thread, start turns, and consume streamed item and completion notifications. Generate TypeScript or JSON schemas from the installed CLI when useful so the client matches that exact version rather than relying on remembered protocol shapes.

The app-server process should reuse the authentication managed by the Codex CLI. Do not read, copy, parse, transmit, or commit `~/.codex/auth.json`, browser credentials, access tokens, or keyring data. Provide an onboarding/status state that tells the developer to run these commands manually when needed:

```sh
devenv shell -- codex login
devenv shell -- codex login status
```

Use a long-lived process during development, with clean startup, cancellation, timeout, crash recovery, and shutdown behavior. Keep the transport local. Send only the relevant design-document slice, selected nodes, recent meaningful operations, component registry, and agency envelope—not the entire canvas history or repository. Reuse a thread when continuity helps, and fork or start a separate thread for a design branch when appropriate.

For design-interpretation turns, use the narrowest supported sandbox, defaulting to read-only, and do not grant shell execution or file-write approvals. The in-product agent’s job is to propose design operations, not edit the repository. If App Server requests execution or mutation approval, deny it and surface a safe diagnostic in development.

Require the Codex turn to return a compact JSON proposal matching Malleable’s typed operation schema. Prefer a supported structured-output/schema field when the pinned App Server version exposes one; otherwise require a strict JSON final response, parse it defensively, and reject anything that does not validate. Freeform prose may be retained as a short rationale but must never be treated as an executable document mutation.

The Codex adapter should use the model to interpret ambiguity, choose among registered component matches, and provide short rationales. Geometry and document mutations remain deterministic. Make the model optional/configurable through a safe server-side setting such as `MALLEABLE_CODEX_MODEL`; query or respect models supported by the signed-in Codex client rather than hardcoding an API-only model.

Useful tool concepts include:

- `propose_semantic_binding`
- `propose_repeater`
- `propose_transition`
- `propose_component_binding`
- `propose_generalization`
- `propose_branch`

It is fine to revise these names, but preserve the constrained protocol. Include timeouts, cancellation, validation errors, App Server crash handling, and graceful fallback to the local adapter. Log only safe development diagnostics; never log credentials, raw authentication state, or sensitive document content.

Do not make an LLM request on every pointer move. Trigger interpretation after meaningful operations, an idle boundary, or explicit actions such as “Interpret selection.” Keep the interaction feeling immediate.

## Component contract and code projection

Include a small local design system implemented in Svelte, with a typed registry/manifest. It should contain enough primitives for the demo—such as Button, Input, Card, Sidebar/Nav item, DataTable or data rows, Badge, and Drawer/Panel.

The registry should describe stable component IDs, import paths, permitted variants, props, slots, and relevant design tokens. Promotion may bind only to registered components and allowed values. The agent must not invent component names, duplicate an existing primitive under a new name, or introduce arbitrary colors/spacing when a registry token applies. A “request new component” proposal may be represented, but it must require explicit approval and is not part of the happy path.

Generate a readable Svelte source projection from the design document. It must:

- use imports from the local design system for promoted regions;
- preserve greybox placeholders for unpromoted regions;
- be deterministically regenerated from the document;
- be syntactically valid and covered by at least one compile or parser test;
- visibly indicate that it is a projection/export in this MVP, not claim full arbitrary bidirectional code editing.

The canvas renderer and source projection should consume the same IR. Avoid a second, drifting representation.

## Technology choices

Unless the existing repository strongly dictates otherwise, use:

- SvelteKit with current Svelte and TypeScript;
- pnpm;
- a DOM/SVG-based editor surface with pointer events rather than a heavyweight full design-tool framework;
- Svelte stores or similarly simple project-local state management;
- Zod or another lightweight schema validator shared by server and client;
- Vitest for reducers, operation history, validators, component-contract rules, and code generation;
- focused component/integration tests where they add confidence.

Avoid a database, authentication, multiplayer collaboration, and production deployment work. Prefer localStorage or IndexedDB for persistence. Do not add a large dependency when a compact project-local implementation is sufficient.

## NixOS and `devenv`

The host is NixOS. Do not assume `node`, `npm`, `pnpm`, `codex`, browser libraries, or other development tools exist globally.

Create and validate a root `devenv.nix` that provides a repo-compatible current Node.js LTS, pnpm through Corepack or nixpkgs, git, the Codex CLI, and any native packages actually required by the project. Use a current Codex package from nixpkgs if it supports the required App Server protocol; otherwise pin a compatible project-local `@openai/codex` package and expose its executable inside the development shell. Do not depend on an untracked global install. Add the minimal companion `devenv.yaml` or `.envrc` only if the installed `devenv` workflow requires it. Keep the environment reproducible and avoid FHS-only assumptions.

All setup and verification commands should work from the environment, for example:

```sh
devenv shell -- node --version
devenv shell -- pnpm --version
devenv shell -- codex --version
devenv shell -- codex login status
devenv shell -- pnpm install
devenv shell -- pnpm check
devenv shell -- pnpm test
devenv shell -- pnpm build
devenv shell -- pnpm dev --host 0.0.0.0
```

Confirm the actual syntax against the installed `devenv` version rather than copying an obsolete template. Confirm that the selected Codex CLI starts App Server and generate protocol bindings from that installed version if the integration uses generated types. Pin or lock dependencies where the normal `devenv` workflow supports it. If end-to-end browser testing is added, configure a Nix-compatible browser package and browser path; do not rely on Playwright downloading an incompatible binary. If that becomes disproportionate, prioritize deterministic unit/integration coverage and a manually verified browser demo.

Create `.env.example` containing only safe, non-secret configuration such as:

```dotenv
MALLEABLE_AGENT_BACKEND=local
MALLEABLE_CODEX_COMMAND=codex
MALLEABLE_CODEX_MODEL=
```

Support `local` and `codex` backends, with a clear UI indicator of which one is active. Authentication is owned by `codex login`; do not ask the user to paste ChatGPT credentials or tokens into `.env`.

## Planning and implementation workflow

Before editing product code:

1. Inspect the repository, current status, local instructions, and available toolchain.
2. Decide whether to extend the existing app or scaffold the minimal SvelteKit project.
3. Write `PLAN.md` with the chosen architecture, data model, interaction slices, implementation order, explicit non-goals, tests, and demo risks.
4. Put the critical vertical slice first: blank canvas → draw/select/transform → semantic Repeat proposal → accept → undo.
5. Then add flow preview, promotion/component contract, generalization, branching, source projection, the Codex App Server adapter, and visual polish.
6. Keep the project runnable after each milestone. Revisit scope if a feature threatens the coherent demo path.

Do not stop after the plan or ask for routine approval. Implement the best coherent version you can, verify it, inspect it in a browser if that capability is available, and repair obvious interaction or visual defects.

## Subagents

You are explicitly authorized to use Codex subagents for planning and implementation when parallel work will materially improve speed or quality.

Good bounded delegations include repository reconnaissance, interaction/data-model review, Codex App Server protocol research, design-system registry implementation, non-overlapping UI surfaces, and independent test/review passes. Keep the main agent responsible for product decisions, shared types, integration, and final verification. Give each subagent a concrete scope and requested output, avoid having multiple agents edit the same files concurrently, wait for their results, and integrate rather than merely concatenate their work. Prefer parallel read/review tasks and carefully partition any write-heavy tasks.

Subagents inherit the repository constraints in this prompt. Do not let delegation broaden scope or weaken validation.

## Acceptance criteria

The task is complete when all of the following are true:

- The project enters successfully through `devenv` on NixOS and has clear setup commands.
- The app opens to a blank canvas and the required demo path can be performed without a Codex login or API key by using the deterministic local adapter.
- Drawing, selection, movement, resizing, semantic Repeat binding, undo/redo, and persistence work.
- At least two screens/states can be connected and exercised in Preview mode.
- Promote maps only to registered design-system components; unknown components and invalid token values are rejected.
- A manual style change can be generalized to an explicit scope.
- Branching preserves the original and produces an inspectable alternative.
- AI suggestions are contextual proposed operations, not hidden direct mutations or chat-only output.
- Protect, Guide, and Explore have visibly different safe behaviors.
- The intent inspector distinguishes ambiguous, inferred, and confirmed intent and shows provenance.
- The Svelte code projection is generated from the same IR, imports registered components, and passes its syntax/compile test.
- When the local Codex CLI is authenticated through ChatGPT, at least one meaningful semantic/component proposal can come through the real Codex App Server adapter and consume the signed-in account’s Codex allowance rather than Platform API billing.
- If Codex is signed out, unavailable, times out, crashes, or returns invalid output, the app clearly reports the condition and degrades gracefully to the deterministic local adapter.
- The App Server transport, login state, and credentials never reach browser code; tests use a fake JSON-RPC transport and do not consume Codex credits by default.
- Type checking, tests, and production build pass from `devenv shell`.
- The UI is visually coherent and usable at common laptop demo dimensions.
- `README.md` explains setup, architecture, the interaction thesis, environment variables, known MVP limitations, and exact demo steps.
- `docs/demo-script.md` contains a reliable sub-three-minute presentation script plus a fallback path using the deterministic checkpoint.

## Explicit non-goals

Do not attempt to build a complete Figma replacement. Leave these out unless the core prototype is already excellent:

- arbitrary vector paths, boolean operations, advanced typography, and production-grade layout engines;
- full arbitrary code-to-canvas round-tripping;
- live multiplayer, comments, permissions, accounts, cloud storage, or deployment infrastructure;
- automatic ingestion of a real external company design system;
- image/video reference understanding or moodboard workflows;
- production-ready code generation for every possible document;
- autonomous raw shell/filesystem access from the in-product design agent.
- a public hosted service that spends the developer’s personal ChatGPT/Codex allowance on behalf of other users.

Document shortcuts and honest limitations instead of disguising incomplete behavior.

## Final handoff

Before finishing:

1. Run formatting, type checks, tests, and the production build inside `devenv`.
2. Review the final diff for accidental files, secrets, brittle mocks, and regressions.
3. Exercise the critical demo path in the actual app where possible.
4. Update `PLAN.md` to reflect completed and deferred work.
5. Return a concise handoff: what works, important files, exact commands, verification results, known limitations, and the strongest next step if more time remains.

Favor a coherent, tactile, truthful prototype over a broad collection of half-working AI features.
