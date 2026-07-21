# Codesign refinement: AI-only generation, shadcn-svelte primitives, and inline visual autocomplete

You are continuing implementation in `https://github.com/richard-parayno/codesign` from the `codesign-new-interaction` branch.

At the time this brief was prepared, the remote branch head was `2f04ff5277687dbaf274137bf6010b21ffab876d` (`generalize settings functionality`). Do not assume that SHA is still current: another Codex thread may land editor-QOL changes before you begin. Fetch the remote branch, inspect its actual latest head, and preserve newer work.

## Product direction

Codesign is visual autocomplete for UI design. The designer works directly on a familiar canvas, explicitly invokes AI on visible work, and receives editable visual continuations in place. AI should propose what the scene could become; it should not be simulated by deterministic rules that always produce the same generic result.

This refinement has three connected goals:

1. Completely remove the deterministic generation backend and every silent local fallback.
2. Integrate the full shadcn-svelte component source as Codesign's initial design-system library, then make it a real set of AI-usable and user-editable primitives.
3. Remove Co-design as a separate editor mode/pane. Generation, candidate review, and fidelity movement must happen inside the normal editor experience. Preview remains a distinct mode.

The unifying requirement is **malleability**: accepted AI output must be ordinary, inspectable, nested scene-graph content. It must appear in Layers, support selection and direct manipulation, expose meaningful component properties and editable content, participate in copy/paste/reparenting/undo/history, and project to real Svelte code. Never flatten a candidate into an image, opaque HTML blob, or monolithic generated component.

## Required worktree and subagent protocol

Do not implement in the user's primary checkout.

1. Inspect repository status, existing worktrees, branches, remotes, `AGENTS.md`, and the true remote head.
2. Create a dedicated worktree and a new implementation branch from the latest `origin/codesign-new-interaction`. Use an explicit branch name such as `codex/inline-ai-shadcn`.
3. Before editing, print and verify the worktree's absolute path, branch, HEAD, and clean/dirty state.
4. Plan before implementation. Identify newer QOL work that this change must preserve.
5. Use subagents where implementation can be divided into bounded, independently verifiable tasks. Do not delegate trivial or tightly coupled edits merely to create parallelism. Good divisions include:
   - deterministic-backend removal and storage migration;
   - shadcn-svelte installation plus component-manifest design;
   - scene-graph/component renderer, Layers, inspector, and code projection;
   - inline candidate/fidelity interaction;
   - tests and independent review.
6. Every implementation subagent must work in the same dedicated worktree unless a genuinely isolated read-only review requires no checkout. Tell each subagent the exact worktree path and branch, and require it to verify both before editing. Subagents must not create unrelated checkouts or edit the primary checkout.
7. Do not trust summaries alone. Inspect every subagent diff, run its focused tests, resolve overlaps deliberately, and validate the integrated result yourself.
8. After implementation, use an independent reviewer subagent to inspect the full diff for regressions, fake component integration, flattened AI output, stale local-backend paths, scope violations, and untested UI behavior. Address its findings or document a justified exception.

## Current seams to inspect first

The following were true at `2f04ff5`; confirm them against the actual head:

- `src/lib/agent/local.ts` fabricates the same heading/content/action-shaped completion from geometry.
- `src/lib/agent/providers/index.ts` exposes `LocalCodesignProvider`, defaults to `local`, and treats deterministic local as a real provider.
- `src/routes/api/agent/+server.ts` contains the local path and optional `CODESIGN_ALLOW_LOCAL_FALLBACK` behavior.
- `GenerationRun`, provider contracts, status routes, settings, `.env.example`, README, docs, and tests encode `local | codex`.
- `src/lib/design-system/registry.ts` contains only nine handcrafted contracts.
- `src/lib/design-system/index.ts` exports component names as strings rather than real components.
- `src/lib/agent/candidate.ts` hardcodes the small component-ID enum.
- Canvas rendering treats a component binding as a styled rectangle plus a component label; it does not render or model the real component composition.
- `src/routes/+page.svelte` defines `EditorMode = 'edit' | 'codesign' | 'preview'`, shows a top-level Co-design switch, gates overlays behind Co-design mode, and mounts `CodesignPanel` in a separate Trace inspector tab.
- `FidelityStops` is primarily inside that separate pane, while `requestedFidelity` is also treated as a global setting.

Do not blindly preserve these structures just because tests currently assert them.

## 1. Remove deterministic generation as a product concept

Delete the executable local-generation path rather than merely hiding it.

- Remove `src/lib/agent/local.ts`, `LocalCodesignProvider`, its descriptor, local generation branches, local status text, local demo instructions, fallback messaging, and environment flags that select or fall back to it.
- Codex App Server becomes the only production generation backend in this iteration. If Codex is signed out, unavailable, rate-limited, cancelled, or returns invalid structured output, show that real state and keep the source design unchanged. Never manufacture a candidate so the UI appears to work.
- Preserve a clean generator/provider interface if it still adds value for future providers, but do not keep a fake provider implementation or provider selector with only one meaningful choice.
- Remove `CODESIGN_AGENT_BACKEND`, `MALLEABLE_AGENT_BACKEND`, and `CODESIGN_ALLOW_LOCAL_FALLBACK` from active configuration. Retain only the pinned Codex command, model, and effort settings that are actually used.
- Simplify `GenerationRun` metadata around the real provider. Remove meaningless `fallback: false` fields if they no longer serve a migration or audit purpose.
- Existing browser projects must still load. Migrate historical local-run records into read-only legacy metadata or a legacy archive; they must not reintroduce a selectable/current local provider. Preserve accepted scene content and audit history.
- Keep all deterministic **safety and engineering infrastructure**: schemas, validators, reducers, scope checks, ID/dependency validation, migrations, operation replay, fixtures, and mock/fake App Server transports in tests. Tests should return predefined structured candidate fixtures; they should not run a deterministic design generator.
- No automated test should consume Codex credits. At most one deliberate live smoke test may be run manually after all fake-transport tests pass.

Acceptance checks:

- Searching product source and docs for `deterministic`, `LocalCodesignProvider`, `localCandidateBatch`, `CODESIGN_ALLOW_LOCAL_FALLBACK`, or an active `backend: 'local'` path finds no live generation behavior.
- Starting without a usable Codex login produces a clear unavailable/signed-out state and no candidate.
- A mocked Codex response still exercises the full request, validation, candidate, partial-acceptance, history, and replay flow.

## 2. Install shadcn-svelte as open source, then build a Codesign component registry around it

The repository currently has no real design-system implementation. Use shadcn-svelte, not React shadcn/ui.

Initialize shadcn-svelte for this Svelte 5/SvelteKit project, then install and commit the full component source using the CLI's supported all-components flow. Prefer non-interactive, reproducible commands after inspecting the current CLI options, for example:

```sh
pnpm dlx shadcn-svelte@latest init \
  --base-color zinc \
  --css src/routes/layout.css \
  --components-alias '$lib/components' \
  --lib-alias '$lib' \
  --utils-alias '$lib/utils' \
  --hooks-alias '$lib/hooks' \
  --ui-alias '$lib/components/ui'

pnpm dlx shadcn-svelte@latest add --all --yes
```

Adapt paths and flags to the inspected repository and CLI. Do not overwrite newer project styling blindly. Commit `components.json`, global theme/token setup, generated component source, required dependencies, and lockfile changes. Keep the existing NixOS `devenv.nix` workflow working.

Installing files is only the first step. Build a typed Codesign registry/manifest that is the single source of truth for:

- stable component and part IDs;
- display name, category, description, and import path;
- actual Svelte export/renderer;
- default size and default editable content;
- supported props and finite prop options where appropriate;
- named slots/parts and allowed child relationships;
- default child composition for compound components;
- whether editor interaction is disabled in Edit and enabled in Preview;
- code-generation metadata.

The manifest must cover every installed shadcn-svelte component directory. A coverage test should fail when an installed component has no manifest entry. It is acceptable for complex components to expose a conservative, valid subset of props initially, but they may not silently disappear from the library.

Do not hand-maintain the same component list independently in `registry.ts`, `candidate.ts`, the component picker, renderer, validator, and code generator. Derive schemas/catalogs from the canonical manifest where technically possible.

### Component-aware scene graph

Extend the scene graph so component output is genuinely editable:

- A component instance is a normal scene node with a stable component ID and editable props.
- Compound components are represented as nested component-part/slot nodes, not one opaque root. For example, a Card may contain Header, Title, Description, Content, and Footer layers; those parts and their text/content must be selectable in Layers.
- Preserve stable parent/child relationships, slot constraints, creation dependencies, and IDs through generation, ghost rendering, partial acceptance, duplication, reparenting, undo/redo, persistence, migration, and replay.
- The AI may create several nested component nodes in one candidate. Validation must accept references to earlier candidate-created parents only when dependency ordering is correct.
- The Properties inspector must expose component props as suitable controls and permit editing text/content, variants, sizes, state, and other safe manifest-defined values through ordinary typed operations.
- Geometry, fill, typography, and other direct edits must continue to work where meaningful. If a design-system prop owns a visual attribute, define and test precedence instead of allowing contradictory state.
- The Layers panel must visibly identify component instances and parts while preserving drag, nesting, rename, duplicate, copy/paste, and selection behavior.
- Add a searchable Components/Assets surface in the existing editor so a designer can insert shadcn primitives manually. AI must not be the only way to create them.
- Render accepted component instances using the real shadcn-svelte sources, or a renderer demonstrably backed by the same manifest and tokens. If the existing SVG canvas requires an HTML overlay or `foreignObject`, first make a focused rendering spike and choose the approach that preserves pan/zoom, clipping, z-order, hit testing, selection, and Preview interaction. Do not leave two diverging visual implementations.
- Candidate ghosts must use the same component-aware renderer as accepted nodes. Acceptance must change lifecycle/status, not convert the candidate into a different or flatter representation.
- Update Svelte projection so it emits real shadcn-svelte imports and nested composition rather than importing placeholder strings.

At minimum, manually verify representative categories: Button/Input/Label, Card composition, Badge/Avatar, Checkbox/Switch, Tabs, Table, Dialog/Sheet, Select/Dropdown Menu, Navigation Menu or Sidebar, and one feedback component. Automated coverage should span the complete manifest even if browser interaction checks use a representative set.

## 3. Integrate Co-design into the editor instead of switching into a separate pane

Remove Co-design as a top-level mode. The primary editor states should be Edit and Preview.

- Remove `codesign` from `EditorMode`, the top-level Co-design mode button, `Open in Co-design`, the separate Trace/Co-design inspector pane, and help text that describes switching modes.
- Keep the existing explicit invocation principle: selecting or drawing never generates automatically.
- `Ctrl/Cmd+Enter` and a contextual button near the current selection should invoke **Complete with Codesign**.
- Continue deriving the complete containing frame/screen as observational context while keeping focus, mutable existing nodes, insertion parents, and editable geometry separate. Whole-scene context is not permission to mutate the whole scene.
- Show observation/mutation scope only when useful: as temporary on-canvas boundaries during generation/review and, if necessary, in a compact contextual popover. Do not require a permanent AI pane before every generation.
- Generation progress and Cancel belong near the selection or candidate toolbar.
- Render the candidate directly on the canvas as the current ghost/native diff without leaving Edit.
- Add a compact on-canvas candidate toolbar near the candidate/selection with candidate navigation, Accept all, partial review, Reject, Reroll, Compare source, and Cancel where applicable.
- Candidate-created layers should appear in Layers in a clearly marked proposed group/state while under review. Designers must be able to select a proposed atomic layer, highlight its evidence, and accept/reject a dependency-safe subset without opening a separate mode.
- Keep the atomic derivation/audit trail, but move its detailed explanation to contextual details or the existing Process history surface. Do not expose private chain-of-thought; retain the evidence-backed Observation / Context / Proposed interpretation / Change / User decision structure.
- Rejected candidates and source comparison must remain revisitable in Process history. The bottom process panel may remain because it is history/debugging, not a separate place where Co-design happens.
- After acceptance, the result immediately becomes ordinary editable content with no special interaction mode.

## 4. Put fidelity movement in the canvas/editor interaction

Fidelity is not a global AI preference hidden in Settings. It is a property of a frame/entity/representation, with optional element overrides.

- Reuse or replace `FidelityStops` as a compact in-editor control attached to the current frame/selection and mirrored in Properties where useful.
- Support frame/canvas-level fidelity plus individual element overrides using the existing representation model rather than merely relabeling nodes.
- Moving to an existing fidelity stop navigates to its saved representation without destroying later work.
- Moving forward to an unrealized fidelity stop stages an AI candidate at that target fidelity; it does not mutate immediately.
- Moving backward shows an existing lower-fidelity representation. Define what happens when none exists instead of inventing one silently.
- Frame fidelity should be inherited by descendants unless a node has an explicit override. The UI must clearly indicate inherited versus overridden state and allow clearing an override.
- AI authorship/origin stays independent from fidelity. Do not introduce `AI-fi` as a literal fidelity value.
- Candidate fidelity navigation, process history, source comparison, and layer selection must remain coherent after removing the Co-design pane.
- Remove the current global `requestedFidelity` setting as the primary control. A default for new AI requests may remain as a minor preference only if the in-editor selection/frame control always takes precedence.

## Preserve the existing AI safety contract

Do not regress the scene-aware request pipeline already present on the branch:

- visual snapshot plus canonical scene graph;
- whole containing scene/frame as observation context;
- separate focus, observation, existing-node mutation, insertion-parent, and editable-region scopes;
- pinned node and pinned atomic-change protection;
- namespaced IDs and nested-create dependencies;
- schema validation before staging;
- stale-revision rejection;
- native ghost candidates and dependency-safe partial acceptance;
- atomic derivation traces and process history;
- model and reasoning metadata (`gpt-5.6-luna`, `high` by default unless the live model catalog says otherwise).

The model decides the visual continuation. The application decides whether the returned operations are valid, safe, in scope, replayable, and renderable.

## Suggested implementation order

1. Inspect actual head, run the existing suite/build, and write a migration plan.
2. Remove the deterministic backend and replace its tests with mocked Codex transport/fixture tests.
3. Initialize/install all shadcn-svelte sources and create the canonical typed manifest with coverage tests.
4. Extend the node, operation, candidate, migration, registry, renderer, Layers, Properties, clipboard, and codegen paths for nested component instances/parts.
5. Replace the Co-design mode/pane with inline invocation, ghost review, candidate layers, and contextual actions.
6. Move fidelity controls into the selection/frame editor flow and validate representation navigation/inheritance.
7. Update README, `.env.example`, demo documentation, shortcuts, settings copy, and migration notes.
8. Run independent review, resolve findings, and provide a browser-tested handoff.

## Validation requirements

Run at least:

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm format:check
devenv shell -- pnpm check
devenv shell -- pnpm test
devenv shell -- pnpm build
```

Add focused automated coverage for:

- no active local/deterministic generation path;
- signed-out/unavailable Codex behavior with no fallback candidate;
- mocked Codex generation with whole-scene context and strict mutation scope;
- full installed-component-to-manifest coverage;
- component prop/slot validation and invalid-child rejection;
- nested AI-created component dependencies;
- component ghost rendering and acceptance without flattening;
- Layers visibility and selection for generated root/part/content nodes;
- property edits, copy/paste, duplication, reparenting, undo/redo, persistence, and replay for component instances;
- real shadcn-svelte code projection;
- inline generation without a Co-design mode;
- partial accept/reject/reroll/compare/history flows;
- frame fidelity inheritance, element override, override clearing, and saved-representation navigation;
- migration of existing v2 browser projects and historical local-run records.

Perform browser QA on a blank project and a migrated saved project:

1. Draw a frame and rough greybox composition.
2. Insert and directly edit several shadcn components manually.
3. Select a rough region and invoke Codesign from the editor using both button and shortcut.
4. Confirm the request observes the complete containing scene but can mutate only the allowed target/insertion region.
5. Review real nested component ghosts in the canvas and Layers.
6. Accept only a dependency-safe subset; reject another change; reroll; compare source.
7. Manipulate accepted components and subparts with normal editor tools.
8. Move a frame and one child through fidelity stops and confirm inheritance/override behavior.
9. Preview an interactive component without breaking Edit-mode selection.
10. Reload and confirm all content, component bindings, representations, candidates, and process history persist.

## Final handoff

Report:

- the worktree path, branch, start SHA, and final SHA;
- the actual newer commits preserved from `codesign-new-interaction`;
- architecture decisions for shadcn rendering, component parts/slots, and fidelity representations;
- deterministic-backend code and configuration removed;
- files and manifests added by shadcn-svelte;
- automated commands and browser scenarios run, with results;
- subagents used and how their work was independently validated;
- reviewer findings and resolutions;
- any complex components that have conservative prop exposure, clearly distinguished from unsupported or missing integration;
- remaining risks or intentionally deferred work.

Do not stop at a plan unless a genuine blocker requires user input. Implement, integrate, test, review, and hand off the completed refinement.
