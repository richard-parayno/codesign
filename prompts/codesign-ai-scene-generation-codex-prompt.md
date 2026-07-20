# Codex implementation prompt: scene-aware Codesign generation

You are continuing implementation in this repository:

- Repository: `https://github.com/richard-parayno/codesign`
- Target branch: `codesign-new-interaction`
- Environment: NixOS; use the existing `devenv.nix` and run Node/pnpm commands through `devenv shell -- ...`

The base editor and the first version of the Codesign candidate/audit architecture already exist. Your task is to plan and then implement the first real AI-powered, scene-aware Codesign generation loop.

Do not stop after producing a plan. Inspect the current implementation, write a concrete plan informed by the actual code, and then implement, test, and validate it end to end.

## Product outcome

Codesign is visual autocomplete for UI design. A designer creates a rough scene with native canvas primitives, selects a shape or group that represents the area or pattern they want to continue, and explicitly invokes Codesign. The AI sees the whole relevant scene, proposes editable native scene-graph operations, and leaves the designer in control of accepting, rejecting, rerolling, pinning, or partially accepting atomic changes.

The AI must not be implemented as a navbar generator or as a collection of hardcoded UI-recognition templates. A tall rectangle on the left side of a dashboard is one useful fixture, but the same interaction and generation pipeline must work for arbitrary UI scenes: forms, profile cards, card grids, settings pages, data tables, headers, onboarding screens, dashboards, and original compositions.

“Use the whole scene as context” means:

- Observe the entire containing frame and its descendants by default. If there is no containing frame, observe the active screen.
- Preserve hierarchy, geometry, z-order, negative space, styles, text, fidelity, provenance, component bindings, and relationships among all scene elements.
- Send both a clean visual rendering of the scene and a structured scene-graph representation.
- Clearly record what scene context was supplied to the model.
- Do not confuse observation permission with mutation permission. The model may see the whole scene while only being allowed to change a narrow, explicitly represented region.

## Worktree and subagent requirements

Do all implementation work in a dedicated Git worktree. Do not modify the user's primary checkout.

1. Before changing anything, inspect `git status`, the current branch, and `git worktree list`.
2. Create a dedicated worktree rooted at `codesign-new-interaction`.
3. If `codesign-new-interaction` is already checked out elsewhere, do not force, detach, delete, or disturb that checkout. Create a clearly named temporary implementation branch from `codesign-new-interaction` inside the new worktree and report the branch name at handoff.
4. Do not push, merge, open a PR, or modify the primary checkout unless explicitly asked.

Use subagents for bounded implementation and review work. Give every subagent:

- the absolute worktree path;
- the exact files or subsystem it owns;
- a requirement to verify `pwd`, branch, and `git status --short` before editing;
- explicit verification commands and expected deliverables.

Avoid parallel edits to the same files. The primary agent remains responsible for inspecting every subagent diff, integrating the work, running the full validation suite, and correcting incomplete or conflicting changes. Before handoff, use a final reviewer subagent to inspect the combined diff for scope violations, scene-context gaps, security issues, and regressions. Validate the review findings yourself rather than accepting a subagent summary at face value.

## Current implementation to preserve and extend

Inspect the repository rather than relying only on this summary. The current branch already includes:

- a direct-manipulation SVG editor and scene graph;
- project persistence and undo/redo;
- generation runs, candidate revisions, atomic changes, derivation traces, and process history;
- `src/routes/api/agent/+server.ts` with local and Codex backends;
- `src/lib/agent/candidate.ts` with bounded schemas and validation;
- `src/lib/agent/codex-client.server.ts` using Codex App Server;
- checked-in App Server TypeScript bindings;
- component registry constraints;
- a deterministic local fallback.

Preserve working editor behavior and the existing user-agency model. Selection or entering Co-design must never generate automatically.

## Provider architecture and authentication

Implement a small provider boundary owned by Codesign rather than coupling the UI directly to Codex App Server. It should be capability-aware rather than pretending every provider supports identical features. The initial providers are:

- deterministic local provider;
- Codex App Server provider.

Leave clean extension points for a future Responses API or LiteLLM-compatible provider, but do not implement ChatGPT-subscription access through LiteLLM and do not require an OpenAI API key for this work.

Codex App Server is the default real-AI path. It must use the individual user's local ChatGPT/Codex authentication. Never read, parse, expose, copy, log, or send `~/.codex/auth.json` from application code.

Extend the App Server client to support:

- `account/read` for connection state;
- `account/login/start` with the App Server-managed ChatGPT browser flow;
- login-completed and account-updated notifications;
- logout if supported cleanly by the pinned protocol;
- a user-visible provider status such as connected account/auth mode and plan type when supplied by App Server;
- clear, non-secret error states for missing login, unavailable model, rate limit, cancellation, and protocol failure.

If the user is already authenticated with `codex login`, reuse that state through App Server. Otherwise expose a Codesign sign-in action that starts the official App Server login flow. App Server must own token persistence and refresh.

Prefer the repository's pinned `@openai/codex` runtime so its protocol matches the checked-in generated bindings. Keep an explicit advanced command override if useful, but do not silently use an arbitrary incompatible `codex` binary from `PATH`. Regenerate bindings from the pinned runtime if the account methods are missing or stale, and keep the runtime and generated schemas in sync.

Keep App Server local. Do not expose its transport on a public or shared network.

## Model configuration

Pin the initial Codesign model configuration to:

```dotenv
CODESIGN_AGENT_BACKEND=codex
CODESIGN_CODEX_MODEL=gpt-5.6-luna
CODESIGN_CODEX_EFFORT=high
```

Add and validate `CODESIGN_CODEX_EFFORT`. Pass both `model` and `effort` on each generation turn. Set the reasoning summary to `none`; do not request, capture, display, or persist private chain-of-thought. Codesign's existing structured derivation traces are the inspectable explanation surface.

Record the effective provider, model, reasoning effort, prompt version, schema version, and generation timestamp on every generation run. Show enough of this information in the UI or process inspector that a designer can tell what produced a candidate.

Do not share one latent conversation across unrelated projects or generation runs. Reuse the App Server process/transport if appropriate, but use an ephemeral thread per generation run unless repository inspection establishes a stronger isolation mechanism. Rerolls must carry their explicit source revision, pins, prior accepted/preserved atomic changes, and scene-context manifest rather than relying on invisible conversational memory.

## Replace the overloaded mutation-scope model

The current `mutationScopeIds` conflates several different concepts. Replace it with an explicit, validated scope model along these lines, adjusting names to fit the repository:

```ts
type GenerationTarget = {
  focusNodeIds: string[];
  observationScope: {
    kind: 'selection' | 'parent' | 'frame' | 'screen';
    rootId?: string;
    nodeIds: string[];
  };
  mutationScope: {
    existingNodeIds: string[];
    insertionParentIds: string[];
    regions: Bounds[];
    allowCreate: boolean;
  };
};
```

The exact types may differ, but preserve these distinct ideas:

- **Focus:** the shapes the designer selected and is asking Codesign to continue or refine. Focus is evidence, not a semantic declaration.
- **Observation scope:** the full scene the model may reference.
- **Existing-node mutation scope:** existing nodes the model may style, move, resize, or update.
- **Insertion parents:** existing containers that may receive newly created native nodes.
- **Editable regions:** geometric regions in which generated content must remain.
- **Pins/protected nodes:** never mutable and never silently overridden.

For the motivating example, if the designer selects a tall grey rectangle inside a dashboard frame:

- focus is the rectangle;
- observation is the entire dashboard frame;
- existing-node mutation initially contains only that rectangle, unless the user explicitly expands it;
- insertion parent is the dashboard frame;
- editable region defaults to the rectangle's bounds;
- dashboard content to the right is visible as context but immutable.

The model may propose that the region behaves like navigation, but that is a labeled proposal based on scene evidence, not a hardcoded classification and not discovered user intent.

Update persisted generation-run types and migrations defensively so existing local v2 projects remain recoverable. Old generation records should stay inspectable even if they lack the richer scope fields.

## Scene context construction

Create one canonical, deterministic scene-context builder used by both real and fake/local providers. It should produce a versioned context manifest containing at least:

- source project/document and revision identifiers where appropriate;
- active screen and observation root;
- focus node IDs;
- every observed node's stable ID, type, name, parent/children, z-order, scene-relative bounds, style, text, component binding, fidelity, origin/provenance, and pinned state;
- frame/screen bounds and relevant empty space or layout relationships;
- mutation scope and insertion rules;
- available design-system components, slots, props, tokens, and allowed raw primitive/style values;
- requested action and fidelity;
- snapshot identity, dimensions, MIME type, and hash;
- schema and prompt versions.

Do not silently degrade “whole scene” into only the selected node and nearest siblings. For scenes below the supported bound, include the complete observation tree. For larger scenes, implement a deterministic bounded strategy that still represents every top-level region and the complete hierarchy while giving full detail to the focus region. Surface when summarization occurred and cover it with tests. Never truncate in a way that makes right-side content invisible when completing a left-side region.

Coordinates sent to the model must use one documented coordinate space, preferably relative to the observation root. Validate all generated coordinates after converting them back to document space.

## Visual snapshot input

The current request contains visual-snapshot metadata but does not actually send a trusted image to Codex. Implement the real path.

From the browser/editor:

- render a clean snapshot of the entire observation root, not merely the selected nodes;
- exclude editor chrome, handles, selection boxes, context boundaries, cursors, menus, candidate ghosts, and debug overlays;
- preserve the actual visual stacking, text, fills, strokes, and empty space;
- rasterize to a supported image format at a bounded, useful resolution;
- send image bytes plus declared metadata to the SvelteKit server.

On the server:

- treat all browser metadata and bytes as untrusted;
- validate MIME type, byte length, decoded dimensions, and a conservative maximum size;
- compute the hash on the server rather than trusting the client hash;
- write only to a random, process-owned temporary path when App Server requires `localImage`;
- pass the trusted absolute path to App Server with an appropriate image-detail setting;
- delete the temporary file in `finally` on success, validation failure, cancellation, timeout, or provider error;
- never accept a browser-provided local path or arbitrary image URL.

The structured scene graph and raster must be supplied together. The image communicates visual relationships; the graph supplies exact IDs, hierarchy, coordinates, constraints, and editable operations.

Persist or reconstruct enough of the context manifest that Process history can later show what revision, observation root, node set, snapshot, scopes, model, and prompt/schema versions produced the candidate. Avoid placing large raw images in ordinary `localStorage`; use the existing source revision for reconstruction or an appropriate local binary store if snapshot persistence is necessary.

## General candidate operations

Keep the result native and editable. Never return screenshots as the design result.

Extend the agent candidate schema only as needed for useful general completion. At minimum support:

- creating frames, groups, rectangles, text, and component instances;
- styling permitted existing or newly created nodes;
- updating permitted text/name properties when needed;
- moving or resizing permitted existing nodes when explicitly inside the mutation scope.

Do not allow the agent to delete user-authored nodes in this initial implementation. Avoid broad reparenting or reordering of existing user content unless it is necessary and can be constrained and audited safely.

Support nested generated hierarchy. A newly created node may use an earlier-created node as its parent only when:

- the parent creation appears earlier in dependency order;
- the child atomic change declares the parent creation dependency;
- the resulting hierarchy is acyclic;
- every generated bound remains inside the editable region;
- the root of the generated hierarchy is inserted into an allowed insertion parent.

Continue to enforce:

- stable namespaced IDs;
- dependency-safe partial acceptance;
- no changes outside the existing-node mutation scope;
- no creation outside allowed regions or insertion parents;
- no mutation of pinned nodes;
- registry/token validation;
- before/after snapshots for every atomic change;
- complete affected/evidence node IDs;
- schema-constrained output followed by server-side semantic validation.

Prefer registered components and tokens when they fit the scene, but do not force every original composition into a component-library template. Raw native primitives remain valid when no component match exists.

## Generation prompt behavior

Refactor the provider prompt around the generic task “complete or continue this visual scene within the supplied scope.” Do not mention navbars except in fixture-specific test data.

The model should:

- use the whole observation scene and image as evidence;
- understand the focus selection as an invitation to propose a continuation, not a declared semantic role;
- preserve the visual logic already present in the scene;
- use spacing, alignment, repetition, hierarchy, and design-system constraints consistently;
- avoid modifying unrelated context;
- return several individually useful atomic changes in dependency order;
- describe objective observations, contextual evidence, a labeled inference/proposal, and the exact proposed change;
- return only the structured candidate output expected by the schema.

Keep the prompt lean and versioned. Do not duplicate the same constraints in multiple prose blocks when the JSON schema or context manifest already represents them.

## Editor interaction

Implement one complete, discoverable interaction:

1. Select any eligible node, group, or frame.
2. Show a contextual **Complete with Codesign** action and a keyboard shortcut such as `Ctrl/Command+Enter`.
3. Do not intercept the shortcut while editing text or using an input, textarea, select, dialog, or contenteditable surface.
4. On invocation, derive and visibly preview the focus, observation boundary, insertion parent, and editable region. The observation boundary is contextual only; it must not imply the whole frame can change.
5. Capture the scene context and start generation.
6. Show a scoped loading state with cancellation.
7. Stage the result as candidate ghosts without mutating the source revision.
8. Preserve existing accept-all, dependency-safe partial acceptance, reject, reroll, pin, source comparison, and process-history behavior.
9. Surface backend/model/effort and whether deterministic fallback was used.
10. Show actionable errors without destroying the user's current selection or design.

Do not make generation automatic when selection changes or when Co-design mode opens.

During real-backend development, provider/auth/model failures must not silently masquerade as successful AI output. Make fallback an explicit configuration or clearly interruptive UI state. It is acceptable to retain deterministic fallback for offline demos, but every fallback candidate must be unmistakably labeled.

## Atomic derivation and audit trail

Continue using structured derivation traces rather than raw model reasoning. Each atomic change must record:

- objective observation;
- relevant scene context and evidence node IDs;
- Codesign's labeled inference or proposal;
- exact proposed operation and affected node IDs;
- before/after state;
- dependencies;
- user decision;
- provider/model/effort and source generation run.

Add process events for generation failure and cancellation if they do not already exist. Preserve rejected and rerolled candidates. The audit trail should let a designer answer: “What did Codesign see, what did it propose, which exact primitive changes were involved, and what did I accept?”

## Validation and evaluation

Build deterministic tests before performing any live model smoke test.

At minimum add or update tests for:

- focus/observation/mutation derivation for a selected child inside a frame;
- frame selection, multi-selection, unframed nodes, nested frames, and pinned nodes;
- complete-scene context inclusion and deterministic ordering;
- large-scene bounded/summarized context without losing top-level regions;
- coordinate normalization and editable-region checks;
- rejection of existing-node mutations outside the explicit scope;
- insertion-parent validation;
- nested created hierarchies and dependency enforcement;
- cycle, bounds, ID-collision, unsupported-token, and stale-revision rejection;
- sanitized snapshot capture and server-side image validation;
- temporary-file cleanup on success, failure, cancellation, and timeout;
- fake App Server authentication notifications;
- fake generation transport proving `gpt-5.6-luna`, `high`, `summary: none`, structured schema, and image input were actually sent;
- provider status, visible fallback labeling, and shortcut focus guards;
- migration/recovery of existing v2 documents and old generation runs.

Create several generic scene fixtures rather than one navbar golden path:

- dashboard with a left placeholder region;
- profile/card composition;
- form or settings page;
- table/filter scene;
- card-grid or onboarding composition.

The tests should validate scopes, invariants, editability, and structural usefulness rather than hardcoding that a particular rectangle must always become a particular component.

Run the full repository checks from the worktree:

```sh
devenv shell -- pnpm format:check
devenv shell -- pnpm check
devenv shell -- pnpm test
devenv shell -- pnpm build
```

Fix failures introduced by this work. Preserve unrelated user changes.

After deterministic and fake-transport tests pass, perform at most one intentional live App Server smoke test if a local ChatGPT-authenticated Codex session is available. Do not place live calls in automated tests. Report whether the live test ran, which model/effort App Server reported, and whether the response used real Codex or deterministic fallback. Never expose credentials or prompt/document contents in logs.

## Acceptance criteria

The implementation is complete when:

- Codesign can detect or initiate official local ChatGPT/Codex authentication through App Server without reading auth files;
- the real turn uses `gpt-5.6-luna` with `high` effort and no reasoning summary;
- a designer can select an arbitrary eligible visual region and explicitly invoke **Complete with Codesign** by button or shortcut;
- the model receives a clean rendering and a structured representation of the whole containing scene;
- observation scope, existing-node mutations, insertion parents, and editable regions are distinct and visibly/auditably represented;
- generated candidates are native, editable, atomic, dependency-aware, and remain ghosted until accepted;
- nested generated UI hierarchies work;
- unrelated scene content remains immutable even though it was visible to the model;
- the same pipeline is demonstrably generic across multiple scene fixtures and contains no navbar-specific production heuristics;
- failures, cancellation, fallback, provider, model, and effort are visible and recorded;
- existing projects remain recoverable;
- all required checks pass in the dedicated worktree;
- a final reviewer subagent's findings have been independently validated and addressed or explicitly documented.

## Final handoff

At the end, provide:

- the worktree path and implementation branch;
- a concise architecture summary;
- the most important files changed;
- how whole-scene context and the new scope model work;
- how authentication works without exposing user credentials;
- tests and validation results;
- whether a live Luna-high smoke test ran and whether fallback occurred;
- known limitations and the next highest-value follow-ups;
- the final `git status --short` and commit status.

Do not push or create a PR unless explicitly asked.
