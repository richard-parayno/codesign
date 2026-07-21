# Codex handoff prompt: Codesign visual-autocomplete pivot

You are continuing work on the existing repository at `https://github.com/richard-parayno/codesign` in the current Codex thread. The product direction below supersedes the earlier Malleable/“design intent compiler” brief. Do not continue optimizing the old intent-hypothesis interaction simply because it already exists.

The target branch **already exists**:

```text
codesign-new-interaction
```

Your job is to plan and implement the migration toward the new interaction model in that branch, using a dedicated git worktree and Codex subagents. Deliver a coherent, tested implementation and documentation update—not just a speculative plan.

## Worktree protocol

Do not edit the primary checkout directly.

1. Inspect the current repository root, `AGENTS.md` files, git status, current branch, and existing worktrees.
2. Record the primary checkout’s initial `git status --short` so you can verify later that it remained untouched.
3. Confirm that `codesign-new-interaction` exists locally or as an available ref. Do not recreate or overwrite it.
4. Run `git worktree list --porcelain`.
5. If `codesign-new-interaction` is already attached to a worktree, use that worktree. Otherwise create a sibling worktree with an explicit, non-broad path, for example:

   ```sh
   git worktree add ../codesign-new-interaction-worktree codesign-new-interaction
   ```

6. Before any edits, confirm inside the chosen worktree:

   ```sh
   pwd
   git branch --show-current
   git status --short
   ```

7. All planning files, source changes, tests, generated bindings, formatting, browser checks, and subagent work must happen inside that worktree.
8. Do not use destructive git commands or discard unrelated changes. Do not push, open a PR, or modify the original checkout unless the user asks later.
9. At handoff, compare the primary checkout’s final status against the initial recorded status and confirm that only the worktree contains this task’s changes.

## Required use of subagents

Use subagents for this implementation. The main agent remains responsible for product interpretation, shared contracts, integration, and final verification.

Start with bounded parallel read/review work. Good initial assignments are:

- one subagent to map the current model/reducer/store and propose a v1→v2 migration;
- one subagent to audit the existing canvas UI and identify the smallest coherent component decomposition for `+page.svelte`;
- one subagent to audit the local/Codex agent adapters and propose the new atomic candidate/trace schema;
- one subagent to act as an HCI/product critic and check the proposed interaction against the product principles below.

After the shared model and interfaces are agreed, delegate implementation only along non-overlapping file boundaries. Avoid concurrent edits to the same file. If write tasks would conflict, run them sequentially or have one agent implement while another reviews.

Every subagent must be told the absolute worktree path and must verify `pwd`, `git branch --show-current`, and `git status --short` before editing. Subagents must work only in the `codesign-new-interaction` worktree.

### Validate subagent work

Do not accept a subagent’s summary as proof that its task is complete. For every write-producing subagent:

1. Inspect the actual files and `git diff` in the worktree.
2. Confirm there are no edits in the primary checkout.
3. Check that the diff matches the delegated scope and does not silently change shared contracts or unrelated behavior.
4. Run the targeted tests, type checking, and formatting relevant to that subagent’s changes.
5. Exercise the changed interaction in the browser when it affects UI behavior.
6. Repair or reject changes that are incomplete, placeholder-only, visually broken, inaccessible, or inconsistent with the shared data model.
7. After integration, run the full verification suite again from the worktree.

Use a final independent reviewer subagent after implementation. Ask it to inspect the complete diff for correctness, interaction regressions, stale intent-era concepts, missing tests, unsafe agent behavior, and divergence between the product thesis and the implemented UI. Validate and address its findings rather than copying its summary into the handoff.

## New product thesis

Codesign is no longer primarily an “intent interpreter.” It is a canvas-native, versioned visual-autocomplete environment where designers sequentially move from rough structure to resolved interface designs with AI-generated continuations that are contextual, atomic, inspectable, reversible, and preserved as part of the design process.

The AI does not claim to know what the designer intended. It proposes plausible visual continuations of what the designer has visibly constructed.

> Designers do not describe the interface. They begin it, select where AI may help, and decide which visual continuations survive.

The design process is a first-class artifact. Rejected candidates, rerolls, partial acceptance, fidelity transitions, and manual refinements are valuable design history—not disposable telemetry.

## Position on the AI/no-AI spectrum

Codesign must remain in the middle of the spectrum:

- A traditional canvas gives authorship almost completely to the designer.
- A chat-based generator gives authorship almost completely to the AI.
- Codesign lets the designer establish visual context and spatial constraints, invoke AI explicitly on a bounded region, inspect candidates in place, and accept, reject, pin, reroll, or partially adopt the result.

AI must not run automatically merely because the user selected several objects. Remove the current Guide-mode behavior that automatically stages “Repeat?” from a multi-selection.

The interaction should feel like visual autocomplete—not a chat assistant, an intent dashboard, or an autonomous screen generator.

## Core interaction

### 1. Design normally

Preserve the existing blank-canvas workflow and direct manipulation:

- frames, rectangles, and text;
- selection and multi-selection;
- movement and resizing;
- pan and zoom;
- layers and projects;
- undo/redo and persistence.

The designer must be able to work without AI involvement.

### 2. Explicitly activate Co-design

Add a clear `Design` / `Co-design` mode or equivalent explicit invocation. Entering Co-design mode makes the current selection the mutation boundary. Do not generate merely on selection.

The initial non-chat actions should support this vocabulary:

- **Complete** — continue a visible visual pattern;
- **Refine** — increase or alter fidelity while preserving chosen structure;
- **Vary** — produce an alternative composition or treatment;
- **Resolve** — map rough primitives into available component-system primitives.

It is acceptable to make only a subset fully available in the first integrated pass, but model the shared request so the vocabulary can expand without another schema rewrite. Do not create dead buttons or pretend unsupported actions work.

### 3. Show candidates on the canvas

The agent must return visual operations, not only semantic labels such as “this is a sidebar.” Render the candidate as a ghost/diff overlay in the canvas. The proposal must remain native structured primitives or component instances—not a flattened screenshot.

Support these designer decisions:

- accept all;
- accept selected atomic changes or generated primitives;
- reject;
- reroll;
- switch candidate;
- pin/protect an existing or generated element so later rerolls preserve it;
- compare the candidate with its source revision.

Partial acceptance is foundational. A designer must be able to accept a generated navigation structure while rejecting a generated profile treatment.

## Canvas and frame awareness

Separate what the AI may observe from what it may change.

### Observation scope

The AI may need context from:

- the selected objects;
- their parent and siblings;
- the containing frame;
- relative position, alignment, containment, repetition, and negative space;
- nearby text and visual primitives;
- existing component bindings and design-system constraints;
- optionally broader page/project patterns in the future.

### Mutation scope

Only the explicitly selected region or chosen frame may be changed. Observing a whole frame must not grant permission to rewrite the whole frame.

Default rule:

> Observe the containing frame; mutate only the selection.

Make both scopes legible in Co-design mode. For example, use a strong selection boundary for mutation scope and a lighter context halo for what the AI can observe. Allow the designer to choose among observation scopes such as Selection, Parent, Frame, and Page where feasible.

Example: a tall grey rectangle against the left edge of a dashboard frame may plausibly be treated as a sidebar because the main content begins to its right. A circle and two text bars inside it may plausibly become a profile section. This inference depends on surrounding geometry, not a text prompt.

The agent input contract should be able to carry both a structured scene-graph slice and a rendered visual snapshot/crop. Inspect the pinned Codex App Server protocol before implementing image input; use its supported input types rather than inventing an API. If visual input cannot be completed safely in this pass, keep the adapter interface capable of receiving a visual snapshot and clearly document the current limitation. The product architecture must not collapse back into selected-node metadata only.

## Atomic design-transformation trace

Do not promise or attempt to expose private raw chain-of-thought. Implement a structured, evidence-backed **derivation trace** that records why a visual continuation was proposed.

Each atomic trace entry should distinguish:

1. **Observation** — an objective user action or visible spatial fact;
2. **Contextual evidence** — relevant relationships to surrounding objects or the frame;
3. **AI inference** — a plausible interpretation, explicitly labeled as an AI proposal rather than truth;
4. **Proposed change** — the exact typed operation and before/after state;
5. **User decision** — accepted, partially accepted, rejected, rerolled, reverted, or manually modified.

Canonical example:

> **Observed:** The user drew a tall grey rectangle against the left edge of the Dashboard frame.  
> **Context:** The main content begins to its right, the rectangle spans most of the frame height, and it contains five vertically repeated rows plus a circle beside two text bars.  
> **Inferred:** This composition is consistent with sidebar navigation containing a profile section.  
> **Proposed:** Create one `Sidebar`, five `NavItem` elements, and one profile menu.  
> **Decision:** The user accepted the Sidebar and NavItems but rejected the profile menu.

Do not phrase the inference as “the user intended a navbar.” Prefer “Codesign proposed treating this as sidebar navigation because…”

Clicking a trace entry should highlight its evidence and affected objects in the canvas and expose a before/after comparison. Evidence references should point to stable frame/node IDs.

### Granularity and transactionality

One generation run is a transaction containing individually inspectable atomic changes. Applying a fully accepted candidate should be transactional, but each atomic change must remain addressable for partial acceptance and later reversal. Model dependencies so the user cannot accidentally accept an invalid child without a required parent.

For the sidebar example, separate changes might include:

- grey region → sidebar container;
- repeated rows → navigation items;
- circle and text → profile section;
- first row → active state;
- spacing → mapped design-system rhythm.

Do not use a single opaque `promote` operation to hide all of those changes.

## Unified audit trail

The existing operation log is a useful foundation, but the new process history must preserve more than accepted mutations.

Persist meaningful events including:

- checkpoint before AI invocation;
- observation and mutation scopes;
- fidelity target;
- visual/context snapshot reference;
- generated candidates;
- candidate viewing and switching;
- rerolls;
- pinned elements;
- atomic accept/reject decisions;
- rejected candidates;
- manual changes after acceptance;
- reverts and comparisons;
- agent/model/backend and prompt/schema version.

Rejected work is part of the design process. Preserve the generated artifacts and operations so a prior candidate can be revisited or reapplied without calling the model again. “Replay” means reapplying the recorded operations, not assuming a stochastic model will regenerate an identical result.

Use an append-oriented event/derivation ledger plus revision snapshots or another robust event-sourced design. Keep applied document operations and proposal-lifecycle events conceptually distinct but linked.

## Fidelity model

Fidelity and authorship are independent dimensions. Do not implement `ai-fi` as a literal fidelity value between mid-fi and hi-fi.

Use a model similar to:

```ts
type Fidelity = 'structure' | 'wireframe' | 'component' | 'visual' | 'production';
type Origin = 'human' | 'ai' | 'mixed';
type RevisionStatus = 'working' | 'candidate' | 'accepted' | 'rejected';
```

“AI-fi” may be a useful user-facing badge or candidate state, but AI can produce proposals at any fidelity.

### Fidelity controls

Prototype a named-stop fidelity control for both frames and individual elements:

```text
Structure — Wireframe — Component — Visual — Production
```

This is not a purely continuous numeric slider. The stops represent meaningfully different representations.

The control has two distinct jobs and must communicate the difference:

1. Navigate to a representation/checkpoint that already exists.
2. Request an AI-generated proposal for a representation that does not exist.

Consider visual states such as:

- solid stop: existing representation;
- hollow stop: representation can be generated;
- spark stop: unaccepted AI candidate exists;
- split stop: multiple candidates or branches exist.

Selecting an existing stop should preview/navigate without spending a model turn. Selecting a missing stop should stage a generation request rather than silently mutate the design.

### Frame and element fidelity

A frame-level fidelity target applies by inheritance to unresolved descendants. An individual element may override it. Preserve mixed fidelity as a valid design state—for example, a high-fidelity profile card inside a wireframe dashboard.

Use an inheritance model conceptually similar to:

```ts
effectiveFidelity = element.fidelityOverride ?? parent.effectiveFidelity ?? frame.targetFidelity;
```

Changing a parent target must produce an inspectable proposal. It must not silently overwrite pinned children, manual refinements, or element-level overrides.

## Stable design identity and representations

Preserve stable identity when one rough primitive expands into a more detailed visual tree. A grey rectangle may later be represented by a sidebar container, navigation items, avatar, labels, and actions.

Move toward a model where a stable design entity can reference multiple representations across fidelities and revisions. This stable identity is not a claim about hidden intent; it simply maintains continuity across the design process.

Adapt exact types to the current reducer/store architecture, but preserve these concepts:

```ts
type DesignEntity = {
  id: string;
  parentId?: string;
  representationIds: string[];
  activeRepresentationId: string;
};

type Representation = {
  id: string;
  entityId: string;
  fidelity: Fidelity;
  origin: Origin;
  revisionId: string;
  rootNodeIds: string[];
};

type GenerationRun = {
  id: string;
  sourceRevisionId: string;
  observationScopeIds: string[];
  mutationScopeIds: string[];
  pinnedIds: string[];
  requestedFidelity: Fidelity;
  contextSnapshotId: string;
  candidateIds: string[];
  backend: 'local' | 'codex';
  model?: string;
  promptVersion: string;
  createdAt: number;
};

type CandidateRevision = {
  id: string;
  generationRunId: string;
  parentRevisionId: string;
  fidelity: Fidelity;
  origin: 'ai';
  atomicChangeIds: string[];
  status: 'candidate' | 'accepted' | 'partially-accepted' | 'rejected';
};
```

Do not copy these types blindly if a smaller normalized model fits the existing code better. Document material deviations and preserve the behavioral contract.

## Agent harness

Preserve and extend the existing local/Codex App Server boundary rather than rebuilding authentication or transport.

- Keep the deterministic local backend so the full interaction can be demonstrated without a login or credit usage.
- Continue using the pinned Codex App Server bindings and ChatGPT-authenticated local Codex workflow.
- Never expose credentials or App Server transport to browser code.
- Keep agent execution read-only with tool/file/shell approvals denied for design-generation turns.
- Update the output schema from one `repeat`/`promote` operation to a candidate containing a batch of atomic visual changes and structured derivation evidence.
- Validate every stable ID, mutation boundary, component binding, token value, dependency, and before/after state before staging a candidate.
- Agent output must never directly mutate the design document.
- Use a fake JSON-RPC transport for automated tests. Do not consume real Codex turns during routine testing.
- After all deterministic and fake-transport tests pass, at most one deliberate live Codex smoke-test generation is authorized. Record whether it was run and its result; do not repeatedly reroll through paid credits while debugging.

## Existing implementation: preserve, replace, and demote

### Preserve and build on

- SVG direct-manipulation canvas;
- frame/rectangle/text drawing;
- selection, movement, resizing, pan, and zoom;
- project/file persistence;
- typed operations and undo/redo;
- design-system registry and validation;
- local and Codex App Server adapters;
- action logging and safe diagnostics;
- SvelteKit/NixOS/devenv setup.

### Replace or remove from the primary interaction

- automatic Guide-mode proposal generation;
- `Protect / Guide / Explore` as the main model of agency;
- the Intent inspector and document intent counts;
- `IntentHypothesis` and semantic commitment as the center of the data model;
- confidence percentages as a substitute for evidence;
- singular `Repeat?`/`Promote` proposal cards as the whole AI experience;
- component-name labels that do not visibly transform the canvas;
- accepted-only history;
- full-screen branching as the only way to preserve alternatives.

Manual repeat/grouping and component binding may remain useful operations, but reframe them as designer-controlled canvas operations rather than proof that the system discovered intent.

### Demote, do not necessarily delete

- flow Preview;
- deterministic Svelte projection;
- screen-level branching.

These can remain functional secondary features, but they must not distract from the new Co-design, fidelity, candidate, and process-history interaction.

The current `src/routes/+page.svelte` is large. Refactor it into coherent Svelte components and project-local modules where that materially improves the new interaction architecture. Do not perform a cosmetic rewrite of unrelated working code, but do not keep adding the entire pivot to one monolithic file.

Rename stale user-facing “Malleable” references to “Codesign” as part of this branch where appropriate.

## Data migration

The existing browser project format is version 1. Introduce a deliberate migration strategy rather than silently discarding saved projects.

- Bump the persisted document/project schema version when required.
- Add tested migration from existing v1 documents to the new representation/revision model.
- Preserve nodes, screens, component bindings, operations, and project metadata where possible.
- Convert or archive old intent hypotheses without presenting them as new derivation traces.
- If some old fields cannot be faithfully migrated, document the loss and keep a recoverable legacy snapshot.

## Planning and implementation sequence

Inside the worktree:

1. Run the current formatting, type-check, tests, and build to establish a baseline before editing.
2. Create `docs/new-interaction-plan.md` covering:
   - current-state audit;
   - shared data model;
   - migration plan;
   - UI/component decomposition;
   - agent schema changes;
   - test strategy;
   - staged implementation milestones;
   - explicit deferred capabilities that the architecture still supports.
3. Use subagents for the initial audits and critique.
4. Stabilize shared types and migration contracts before parallel write-heavy implementation.
5. Implement the revision/event/atomic-change foundation and tests.
6. Implement explicit Co-design mode, observation/mutation scope, and ghost candidate rendering.
7. Implement atomic accept/reject, pinning, reroll/candidate lifecycle, and derivation trace inspection.
8. Implement frame- and element-level fidelity controls plus representation navigation/generation states.
9. Update the local backend, then the Codex adapter and fake transport tests.
10. Migrate or remove stale intent-era UI and copy.
11. Update README, architecture documentation, and the demo script to reflect the new thesis truthfully.
12. Run an independent reviewer subagent and address validated findings.
13. Run the complete verification suite and browser QA in the worktree.

Do not stop after writing the plan. Maintain the plan as a living implementation record.

## Acceptance criteria

The first coherent migration is complete when:

- all work exists only in the `codesign-new-interaction` worktree and branch;
- the primary checkout remains unchanged;
- current baseline functionality not intentionally superseded still works;
- AI is activated explicitly, never merely by multi-selection;
- Co-design mode visibly distinguishes observation scope from mutation scope;
- a selected region can produce at least one native visual candidate as a ghost/diff overlay;
- the candidate contains multiple typed atomic changes rather than a single opaque promotion;
- each atomic change has evidence-linked observation, context, inference, proposed before/after, and user-decision fields;
- trace entries can highlight their evidence and affected objects on the canvas;
- the user can accept all, accept a meaningful subset, reject, reroll, and pin at least one element;
- rejected candidates and partial acceptance remain in persistent process history;
- the process history can navigate back to the source representation without regenerating it;
- frame- and element-level named fidelity controls are present and distinguish existing representations from missing/generatable ones;
- element fidelity can override inherited frame fidelity without being overwritten;
- `ai-fi` is represented as origin/candidate state rather than a fidelity enum value;
- existing component-registry constraints still reject invented components and invalid props/tokens;
- old intent confidence/counts and Protect/Guide/Explore are removed from the primary UX;
- v1 saved projects have a tested migration or a documented recoverable compatibility path;
- the local deterministic backend supports the full demonstrated interaction without Codex login;
- the Codex adapter validates candidate batches and derivation traces through the pinned App Server schema;
- automated tests do not consume Codex credits;
- formatting, Svelte checks, unit/integration tests, and production build pass inside `devenv`;
- browser QA covers blank design, manual drawing, explicit Co-design invocation, candidate preview, atomic inspection, partial acceptance, rejection/reroll, pinning, fidelity navigation, history replay, reload persistence, and a migrated project;
- README and demo documentation describe Codesign as visual autocomplete across fidelity—not an intent interpreter.

## Long-term architectural direction

Do not let the hackathon demo impose a conceptual ceiling. The implementation should establish durable primitives for future work including:

- richer vector and auto-layout behavior;
- visual reference and moodboard context;
- real company design-system ingestion;
- cross-frame and cross-screen pattern consistency;
- multiple candidate comparison and merging;
- collaborative review of AI derivation traces;
- high-fidelity interaction behavior;
- stronger code/component round-tripping;
- a dedicated design-agent harness beyond the current Codex adapter;
- evaluation of when visual autocomplete supports or disrupts designer agency.

Near-term scope may defer those surfaces, but shared types and UI metaphors must not falsely assume there will only ever be one candidate, one screen, one fidelity transition, or one agent backend.

## Final handoff

Before returning:

1. Inspect the complete worktree diff and `git diff --check`.
2. Verify all subagent changes from source and tests, not summaries.
3. Run formatting, type checking, tests, and production build through `devenv`.
4. Exercise the critical interaction in the browser and inspect console/application errors.
5. Confirm the original checkout status is unchanged.
6. Update `docs/new-interaction-plan.md` with completed, deferred, and risky items.
7. Return a concise handoff containing:
   - worktree path and branch;
   - implemented interaction;
   - important architecture decisions;
   - files changed;
   - subagents used and how their work was validated;
   - exact verification commands and results;
   - whether the one permitted live Codex smoke test was used;
   - known limitations and the strongest next step.

Build the new direction as an extensible product foundation, while ensuring the implemented interaction is real, inspectable, and usable rather than a collection of architectural placeholders.
