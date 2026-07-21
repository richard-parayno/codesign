# Codesign agent-harness architecture implementation prompt

You are working on the existing repository:

- Repository: `https://github.com/richard-parayno/codesign`
- Base branch: `codesign-new-interaction`

Implement the next architecture of Codesign as an **agent-operable visual design harness**. Do not stop at an architecture proposal. Inspect the latest branch head, make the implementation, validate it end to end, and leave the work in a reviewable branch/worktree.

## Product direction

Codesign should no longer use Codex App Server as a one-shot multimodal structured-output endpoint that receives an enormous scene prompt and returns a complete candidate JSON blob.

Instead, Codesign should give an AI agent:

- read access to the whole relevant scene;
- a compact initial orientation rather than a full catalog dump;
- on-demand tools for inspecting the layer tree and rendering the scene;
- on-demand search and description of shadcn-svelte components;
- strictly scoped write access to a copy-on-write candidate scene;
- deterministic validation and replay of its operations;
- the ability to inspect, repair, and resubmit its candidate before human review.

The agent's equivalent of source code is the canonical Codesign scene/layout representation. Generated Svelte and screenshots are projections of that representation, not its source of truth.

Images are still useful, but they should become an on-demand visual inspection tool within the agent loop—not the entire generation architecture.

The coding-harness analogy is:

| Coding harness | Codesign harness |
|---|---|
| Repository | Immutable source scene revision |
| Files and AST | Layer tree, layout IR, and component instances |
| Read/search tools | Scene inspection, rendering, and component search |
| File edits | Candidate-only scene operations |
| Type checker/tests | Scope, component, geometry, and layout validators |
| Git diff | Ghost candidate overlay and atomic visual diff |
| Commit | Designer accepts all or selected candidate changes |

## Mandatory worktree and subagent protocol

Do all implementation in dedicated worktrees. Leave the user's primary checkout untouched.

1. Start with a read-only preflight in the primary checkout:
   - fetch the latest remote state;
   - inspect `git status`, existing worktrees, the current branch, and the exact head of `codesign-new-interaction`;
   - inspect repository instructions such as `AGENTS.md` and relevant package scripts;
   - identify any concurrent editor-QOL work and do not overwrite, revert, or absorb uncommitted user changes.
2. Create a dedicated integration worktree and a new implementation branch based on the latest intended `codesign-new-interaction` head. Use a clear name such as `codesign-agent-harness`; if it already exists, use a safe suffixed name. Do not force-delete or reuse an ambiguous worktree.
3. Use subagents where the work can be bounded cleanly. At minimum, delegate:
   - current architecture and App Server capability inspection;
   - canvas-session/tool service implementation;
   - transport/CLI or MCP integration;
   - test coverage or final independent review.
4. Parallel implementation subagents must not edit the same working directory. Give each implementation subagent its own child worktree and branch based on the integration branch. Read-only research/review agents may inspect the integration worktree without editing.
5. Before editing, every implementation subagent must report and verify:
   - `pwd`;
   - `git rev-parse --show-toplevel`;
   - `git branch --show-current`;
   - `git status --short`.
6. Give each subagent bounded ownership and explicit files/interfaces. Avoid overlapping edits. Require each implementation subagent to run focused tests and commit its changes.
7. Do not trust subagent summaries. Before integrating any subagent work:
   - inspect its commit and full diff;
   - verify it changed only the intended area;
   - run its focused tests in its worktree;
   - then cherry-pick or otherwise deliberately integrate it into the integration worktree.
8. After integration, rerun the complete validation suite in the integration worktree. Use a final independent reviewer subagent to inspect the combined diff for architecture drift, unsafe scope behavior, lifecycle leaks, regressions, and incomplete removal of the one-shot path. Address its actionable findings and rerun affected checks.

## Inspect before changing

The latest known checkpoint exposed these seams, but verify all of them against the actual latest head rather than assuming filenames or line numbers are unchanged:

- `src/lib/agent/prompt-template.ts` tells Codex not to use tools.
- `src/lib/agent/codex-client.server.ts` receives tool-call events but rejects them.
- `src/lib/agent/scene-context.ts` serializes the complete component catalog and all component parts into every generation prompt.
- `src/lib/agent/visual-snapshot.server.ts` treats a snapshot callback timeout as if it owns the entire model generation lifecycle.
- `src/routes/api/agent/+server.ts` wraps provider generation inside that snapshot callback.
- The accepted-document/candidate split, atomic candidate operations, scope validators, ghost review, partial acceptance, process history, shadcn manifest, and inline editor interaction are foundations to preserve.

Document the actual current request path and relevant types before modifying them. Prefer migration and extraction over a greenfield rewrite.

## Required architecture

### 1. Introduce one canonical canvas-session service

Create a server-side, transport-independent service such as `CanvasSessionService`. Names may follow repository conventions, but there must be one source of truth used by App Server tool dispatch, MCP, the CLI, and tests.

Each generation session must contain:

- a session ID and lifecycle state;
- an immutable source document/revision;
- the complete relevant scene as read-only observation context;
- focus node IDs;
- editable existing-node IDs;
- allowed insertion-parent IDs;
- editable geometric regions;
- pinned node/change IDs;
- requested fidelity and generation action;
- a copy-on-write candidate document;
- ordered atomic candidate operations and validation results;
- render artifacts owned by the session;
- model/backend metadata and operational derivation events;
- cancellation, expiry, cleanup, and submission state.

The accepted document must never be mutated while the agent is working. Only an explicit human acceptance action may apply all or selected candidate operations to it.

Use a typed storage/lifecycle boundary. An in-memory implementation with bounded TTL is acceptable for this stage, provided sessions and artifacts are cleaned up on success, cancellation, timeout, client disconnect, and expiry.

### 2. Preserve whole-scene context while separating read and write authority

Model the generation target explicitly. Adapt names to the existing schema where useful:

```ts
type GenerationTarget = {
  focusNodeIds: string[];
  observationScope: {
    rootNodeIds: string[];
    mode: 'containing-frame' | 'active-screen' | 'scene';
  };
  mutationScope: {
    existingNodeIds: string[];
    insertionParentIds: string[];
    editableRegions: Bounds[];
  };
  pinnedNodeIds: string[];
};
```

"Whole scene" means the agent may inspect the complete active scene, screen, or containing frame needed to understand composition, hierarchy, whitespace, styles, and neighboring patterns. It does **not** mean the agent may edit everything.

Every mutating tool call must enforce mutation scope server-side. Never rely on prompt instructions alone. Block edits to pinned nodes, unrelated siblings, forbidden parents, or geometry outside allowed regions. Return structured, repairable validation errors to the agent.

Created nodes may reference previously created parents or dependencies in the same candidate session so the agent can build nested, editable shadcn component structures rather than flat rectangles.

### 3. Add a small canvas-native tool vocabulary

Implement typed, schema-validated tools along these lines:

```text
scene.overview
scene.get_nodes
scene.render
components.search
components.describe
candidate.get_state
candidate.apply_changes
candidate.validate
candidate.submit
```

Keep the initial vocabulary small. Add a tool only when it represents a stable domain capability, not a single UI scenario.

Expected semantics:

- `scene.overview` returns a compact hierarchy, frame geometry, focus, scopes, pins, fidelity, available style/token summary, and high-signal relationships. It must not dump the entire document or component catalog by default.
- `scene.get_nodes` retrieves exact nodes, descendants, siblings, computed layout, component bindings, and relevant provenance by stable IDs.
- `scene.render` renders either source or current candidate state for the full observation scope or a focused crop. It returns an App-Server-consumable image reference plus dimensions and a content hash.
- `components.search` searches the canonical shadcn-svelte/Codesign manifest using query, role, category, slots, and capabilities.
- `components.describe` returns exact contracts only for requested components: props, variants, parts, slots, permitted children, defaults, tokens, and editable mappings.
- `candidate.get_state` returns a compact summary or selected slices of the current ghost candidate and its accumulated operations.
- `candidate.apply_changes` applies a bounded batch of atomic operations to the candidate only. It requires evidence node IDs and a concise user-facing derivation summary for each meaningful change group.
- `candidate.validate` runs scope, dependency, component, geometry, layout, hierarchy, and renderability validation and returns repairable diagnostics.
- `candidate.submit` succeeds only when the candidate is valid and freezes a reviewable candidate revision for the editor.

Tool payloads and results must be bounded and paginatable where appropriate. Avoid returning giant unbounded JSON trees.

### 4. Make the scene representation genuinely malleable

Do not let the agent merely place labelled component rectangles. Preserve or extend the scene IR so generated results are editable through Layers, Properties, direct manipulation, copy/paste, reparenting, undo/redo, history, and Svelte projection.

Support layout properties sufficient for agent-created UI structures to remain responsive and understandable, for example:

```ts
type LayoutProperties = {
  mode: 'none' | 'horizontal' | 'vertical' | 'grid';
  gap?: number;
  padding?: number | { top: number; right: number; bottom: number; left: number };
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'space-between';
  widthMode?: 'fixed' | 'hug' | 'fill';
  heightMode?: 'fixed' | 'hug' | 'fill';
  gridColumns?: number;
};
```

Integrate this with existing node/component schemas, reducers, persistence, renderer, inspector, and migration paths. Do not create a separate AI-only document format.

The canonical component manifest must continue to drive:

- agent component discovery and validation;
- canvas rendering;
- Layers and Properties behavior;
- manual component insertion;
- generated Svelte projection.

### 5. Turn Codex App Server into an agent runtime

Replace the current "never use tools" instruction and rejected tool-call behavior with a real dispatch loop backed by `CanvasSessionService`.

- Feature-probe the pinned Codex binary and generated App Server schema for dynamic/custom-tool support.
- Use the supported, typed App Server mechanism when available.
- Do not cast around generated types or assume a documentation-only experimental field works.
- If first-class dynamic tools are unavailable in the pinned version, expose the same canonical tool service through a local Codesign MCP server and configure the Codex session to use it.
- Keep the transport boundary explicit so dynamic tools and MCP do not acquire separate business logic.
- Keep the configured default model and reasoning effort at `gpt-5.6-luna` / `high`, but preserve user configurability and record the effective values on the run.
- Do not expose or request hidden chain-of-thought. User-visible traces come from tool activity, evidence, atomic operations, validation, and designer decisions.

Reduce the initial prompt to the product objective, session/scoping rules, compact scene orientation, and tool instructions. Do not send the full scene graph or full shadcn catalog up front.

The agent should be able to:

1. inspect the whole relevant scene;
2. inspect selected/focused nodes;
3. request a source render if needed;
4. search and inspect relevant components;
5. apply a small candidate change batch;
6. see the ghost state update;
7. render and inspect the candidate;
8. validate and repair it;
9. submit it for human review.

Use a small final submission record or the `candidate.submit` tool rather than requiring the entire design to be emitted through one giant structured-output schema.

### 6. Add a thin agent-operable CLI

Expose the canonical service through a CLI suitable for debugging, fixtures, tests, and future harness integrations. The CLI is an adapter, not the source of truth.

Provide discoverable help and machine-readable JSON input/output for operations equivalent to:

```text
session create
scene overview
scene get-nodes
scene render
components search
components describe
candidate state
candidate apply
candidate validate
candidate submit
session cancel
```

Follow existing package conventions. Avoid inventing a second scene mutation path. Include at least one documented/scripted end-to-end CLI fixture that creates a session, inspects a scene, applies candidate operations, validates, submits, and confirms the accepted document is unchanged.

### 7. Make image rendering session-scoped and on demand

Fix the known lifecycle flaw even if other architecture work proceeds in parallel:

- Snapshot preparation must have its own short timeout.
- Model generation must have a separate, longer, configurable timeout.
- A successfully created render becomes a session-owned resource lease retained until generation/tool use completes.
- Cleanup must occur after success, cancellation, timeout, disconnect, or expiry—not when an unrelated callback returns.
- `scene.render` must support the current candidate as well as the source scene.
- Prefer server-side/session-side rendering so repeated base64 browser uploads are unnecessary. If the browser renderer must remain temporarily for visual fidelity, ingest the initial render once and manage it as a session artifact.
- Deduplicate renders by source/candidate revision, scope, and content hash where safe.

Record separate timings for:

- request/session creation;
- source snapshot preparation;
- App Server thread creation;
- turn acknowledgement;
- first tool call or first output;
- each tool duration;
- first candidate mutation;
- validation;
- submission/completion;
- cleanup.

Errors must name the actual failed stage. A model timeout must never be reported as a visual snapshot timeout.

### 8. Stream agent work into the inline editor experience

Keep Codesign integrated into the editor rather than reviving a separate Co-design pane or mode.

- Invoking Codesign from a selection/keybind creates a candidate session.
- Successful `candidate.apply_changes` calls stream incremental ghost updates to the canvas and Layers tree without mutating the accepted document.
- Show lightweight progress such as inspecting scene, searching components, applying candidate changes, validating, and ready for review.
- Preserve direct manipulation and existing editor controls wherever safe during generation; clearly handle conflicts or source revision drift.
- Retain inline accept-all, partial accept, reject, reroll, pin, compare, fidelity, and candidate-switching behavior.
- Rejected candidates and operational traces remain in process history.
- If the source document changes incompatibly during a run, detect revision drift and ask the user to rerun or explicitly rebase; never silently apply stale operations.

The existing activity/telemetry stream may remain as diagnostics, but it must not be the only way the designer understands progress or failure.

### 9. Record operational derivation traces

For every agent read/mutation/validation event, record enough evidence to reconstruct how a candidate was produced without exposing private model reasoning:

- tool name and bounded arguments/result summary;
- source and candidate revision IDs;
- observed/evidence node IDs;
- render hash and scope when a render was inspected;
- component contracts consulted;
- proposed atomic operations;
- concise evidence-backed user-facing explanation;
- validation results and repairs;
- timestamps and durations;
- final submit, accept, partial accept, reject, reroll, or manual-edit decision.

Example user-facing derivation:

> Observed a tall region along the frame's left edge, with the main content beginning to its right. Consulted the Sidebar and SidebarMenu contracts and proposed a vertical navigation composition inside the allowed region.

This is an operational audit trail, not a request to reveal chain-of-thought.

## Remove or retire the old product path

Once the new flow has equivalent or better coverage:

- remove the prompt instruction forbidding tools;
- remove production code that sends the entire component catalog on every run;
- remove the requirement that the entire candidate be returned as a single structured-output object;
- remove the blanket rejection of App Server tool calls;
- remove the snapshot callback that owns model-generation lifetime;
- remove obsolete one-shot-only types and UI states;
- do not reintroduce deterministic or silent fallback generation.

Keep deterministic reducers, validators, fixtures, replay, and mocked transports. Deterministic code decides whether an AI operation is safe and reproducible; it must not fabricate the visual autocomplete result.

If a temporary compatibility path is required during migration, keep it explicitly named, disabled by default, clearly surfaced in diagnostics, and covered by a removal issue/TODO. Do not silently route failed agent runs back to the old behavior.

## Generalization requirements

Do not implement navbar-specific prompt logic, geometry classifiers, component hard-coding, or production heuristics. A sidebar is only one useful test fixture.

Validate the architecture with several scene types, such as:

- a dashboard with an incomplete navigation/content pattern;
- a form with partially defined fields and actions;
- a card grid with one established repeated item;
- a data table or settings screen;
- an onboarding or profile composition.

The agent must use the same scene/component tools and scoped candidate operations for all of them.

## Testing and validation

Use mocked/fake App Server transcripts for routine automated tests. Do not require live credentials in CI. Perform at most one clearly labeled live Codex smoke test if the environment is already authenticated and permits it; never treat lack of credentials as a reason to skip mocked end-to-end coverage.

Add or update tests for at least:

- immutable accepted document and copy-on-write candidate behavior;
- focus, observation, mutation, insertion-parent, pin, and editable-region enforcement;
- rejection of adversarial out-of-scope and stale-revision mutations;
- nested created-node dependencies;
- component search/describe without full-catalog prompt dumping;
- shadcn component contracts, editable parts/props, and Layers representation;
- layout IR reducer, renderer, persistence, migration, and undo/redo;
- render lease cleanup on success, cancel, timeout, disconnect, and expiry;
- independent snapshot and model timeouts with accurate error attribution;
- mocked tool-call dispatch, iterative repair, validation, and submit flow;
- progressive candidate events and UI state restoration after failure/cancel;
- partial acceptance and rejection preserving process history;
- CLI JSON contracts and an end-to-end CLI smoke fixture;
- existing editor QOL interactions and saved-project compatibility.

Run the repository's full relevant checks, including formatting/linting, type checking, unit/integration tests, production build, and browser/E2E tests. Exercise the interaction in a real browser if the repository has a browser harness:

1. Open an existing or fixture project.
2. Select an incomplete region in a scene containing other contextual elements.
3. Invoke Codesign through the inline editor control/keybind.
4. Confirm the agent inspects the broader scene and retrieves only relevant component contracts.
5. Observe progressive ghost changes without accepted-document mutation.
6. Confirm the candidate is represented as nested, editable layers/components.
7. Confirm out-of-scope changes are blocked and repairable.
8. Confirm the agent can render, validate, repair, and submit.
9. Partially accept some operations and reject others.
10. Manipulate accepted elements through the editor and confirm undo/redo and persistence.
11. Inspect the operational derivation history.

Also inspect prompt/request sizes and generation timing before and after the migration. The result should no longer contain an unbounded full scene/component catalog payload.

## Completion criteria

The work is complete when:

- Codesign runs generation as an iterative, canvas-tool-using agent session;
- the complete relevant scene is available for observation without granting global mutation authority;
- component contracts are discovered on demand;
- source and candidate renders are available on demand;
- candidate construction streams into the inline editor as editable ghost layers;
- accepted documents stay immutable until human acceptance;
- all mutations are scope-checked, atomic, replayable, and auditable;
- shadcn-based results remain malleable through normal editor operations;
- the CLI exercises the same canonical service used by the agent transport;
- the snapshot/model lifecycle bug and misleading timeout reporting are fixed;
- the old giant one-shot generation path and deterministic generation are not active production paths;
- all automated and browser checks pass in the integration worktree;
- the original checkout remains untouched;
- every subagent change has been inspected and validated;
- the final independent review has been addressed.

## Final handoff

At the end, provide:

- the integration worktree path and branch name;
- the exact base commit and final commit(s);
- a concise architecture summary and the primary files changed;
- subagents used, their ownership, their branches/commits, and how their work was validated;
- App Server dynamic-tool capability discovered and whether the implementation uses dynamic tools or MCP;
- commands run and their results;
- manual/browser scenarios verified;
- before/after prompt-size and lifecycle timing observations where available;
- any remaining risks or intentionally deferred work;
- confirmation that the primary checkout was not modified.

Do not push, open a pull request, or alter the remote branch unless explicitly instructed by the user.
