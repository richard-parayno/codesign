# Codesign visual-autocomplete migration

## Current-state audit

The existing editor already provides the durable non-AI foundation: an SVG canvas, direct drawing and manipulation, projects, typed operations, undo/redo, persistence, a component registry, local generation, and a constrained Codex App Server transport.

The old primary interaction is intentionally superseded. Selection currently triggers an automatic Guide proposal, proposals contain one opaque `repeat` or `promote` operation, the inspector centers intent commitments/confidence, and history keeps only applied mutations. The pivot removes those concepts from the primary UX while retaining legacy fields only for migration and compatibility.

## Product contract

- Edit mode is the default and never invokes AI.
- Co-design is explicit. Each generation request captures the current selected nodes and source revision as an immutable mutation boundary.
- Observation and mutation scopes are distinct and visibly labelled. The default is “observe containing frame, mutate selection”; a spatial containment fallback is used when old nodes lack parents.
- Complete, Refine, Vary, and Resolve are modeled in one request vocabulary. This MVP exposes only Complete because it is the only action implemented end to end; unsupported actions return `422` rather than appearing as dead controls.
- Candidates are structured SVG primitives/component instances rendered as a ghost overlay. Source state remains unchanged until acceptance.
- One generation run may keep multiple candidates. Rerolls append; they never overwrite prior candidates.
- Atomic changes have dependencies, evidence-linked derivation traces, computed before/after state, and individual decisions.
- Accept-all and dependency-closed partial acceptance are transactional. Reject, reroll, view, compare, and pin are persisted process events.
- Inference copy is explicitly provisional: “Codesign proposed … because …”, never “the user intended …”.
- Fidelity and origin remain independent. Fidelity uses named stops: Structure, Wireframe, Component, Visual, Production.

## Shared data model

The v2 document remains the materialized canvas for compatibility and adds:

- stable design entities and fidelity representations;
- immutable revision snapshots and a current revision ID;
- context snapshots separating observation and mutation scopes;
- generation runs, multiple candidate revisions, atomic changes, and trace evidence;
- pinned node IDs and frame/element fidelity state;
- an append-oriented process event ledger separate from applied operation history;
- a recoverable legacy archive.

Candidate operations use the existing typed operation reducer where possible. Candidate templates receive fresh operation IDs at acceptance/replay. A transaction clones once, validates every dependency and operation, and commits one document revision or none.

## Migration and persistence

- Persist v2 under `codesign.projects.v2`; never overwrite or delete `malleable.projects.v1` or `malleable.document.v1` during the compatibility window.
- Restore order: valid v2, v1 project envelope, legacy single document, blank.
- Migration preserves projects, nodes, screens, component bindings, repeaters, transitions, branches, and operation records.
- Old hypotheses/semantic commitments are archived in the legacy snapshot and are not converted into derivation evidence.
- Legacy protected nodes become pinned nodes. Bound nodes migrate at Component fidelity; other nodes migrate at Wireframe.
- Parse/migration/write failures leave raw legacy storage untouched and keep an in-memory blank project usable.

## UI decomposition

The first pass keeps `+page.svelte` as controller and extracts the new interaction surfaces:

- `src/lib/codesign/CodesignPanel.svelte`: action, scopes, candidate tabs, atomic decisions, reroll/reject/accept, pins, and trace controls.
- `src/lib/codesign/FidelityStops.svelte`: reusable named-stop control with existing/available/candidate states.
- `src/lib/codesign/ProcessPanel.svelte`: persistent candidate/process history and source comparison/replay controls.
- `src/lib/agent/candidate.ts`: shared request normalization, scope, pin, dependency, and candidate validation.

The canvas remains in the page for this pass so existing pointer behavior is not destabilized. Candidate overlays, observation halos, mutation boundaries, evidence highlights, and source comparison are added directly to its transformed SVG group. Further canvas/header/sidebar extraction is deferred until the candidate contract is proven.

## Agent schema

The Codex adapter consumes a `GenerationRequest` containing source revision, action, requested fidelity, structured scene graph, separate observation/mutation IDs, pins, registry contract, and optional visual snapshot metadata. It produces the validated candidate batch schema.

Server validation owns backend/model/prompt metadata and rejects stale revisions, out-of-bound mutations, pinned targets, unknown IDs, invalid dependencies, invented components/props, and invalid before/after state. Model output never mutates the live document.

The pinned App Server supports typed `image` and `localImage` user inputs. This pass keeps the adapter capable of receiving a trusted server-resolved visual input. Browser capture, secure snapshot file storage, and retention are deferred; structured scene context remains complete and the limitation is surfaced truthfully.

## Test strategy

- v1 project and single-document migration, recoverability, v2 persistence, and project isolation;
- candidate schema/reference/scope/pin/dependency validation;
- transaction all-or-nothing behavior, partial acceptance, reject, reroll, replay, and stale source handling;
- fidelity inheritance and element override;
- predefined candidate fixtures plus explicit rejection of unsupported actions;
- fake JSON-RPC candidate streaming, output schema, read-only sandbox, and typed visual input;
- browser QA for blank design, explicit invocation, scopes, ghost preview, trace highlight, partial/all acceptance, reject/reroll, pinning, fidelity stops, history/source compare, reload, and migrated storage.

## Milestones

- [x] Baseline verification and parallel audits
- [x] v2 types, migration, revision/process helpers, and tests
- [x] normalized local/Codex candidate contract and tests
- [x] inline Codesign invocation and temporary scope overlay in Edit
- [x] candidate preview, atomic decisions, pin/reroll, and trace highlighting
- [x] fidelity controls and process/source history
- [x] stale intent-era UI/copy removal and Codesign naming
- [x] independent review, full verification, and browser QA

## Explicitly deferred but supported

- Rasterizing and retaining trusted canvas crops for multimodal input
- More than two simultaneous visible candidates and candidate merging
- Arbitrary nested auto-layout and richer vector primitives
- Full entity tree expansion across multiple fidelity representations
- Production-fidelity code round-tripping
- Live Codex generation is limited to one deliberate smoke test after fixture/fake-transport tests

## Known risks

- Spatial containment must stand in for missing parent IDs in migrated documents.
- Candidate operations must not reuse archived operation IDs during replay.
- Large localStorage snapshots need bounded candidate/revision retention in a later storage pass.
- The 1024px layout cannot support another floating canvas card; Co-design review belongs in the inspector/bottom dock.
- Pinned descendants and dependency closure must be revalidated at acceptance, not only generation.
