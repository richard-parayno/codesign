# Inline AI and shadcn-svelte migration

This migration starts from `a2ad5b3` on `codesign-new-interaction`. It preserves the newer
cross-panel canvas pointer-capture behavior added after the original feature brief.

## Contract changes

- Codex App Server is the only active generator. Historical local generation records remain
  readable as legacy audit metadata, but cannot be selected or executed.
- The shadcn-svelte component manifest is the canonical component catalog for validation,
  manual insertion, rendering hints, inspector controls, and Svelte projection.
- Component roots and compound parts remain ordinary nested scene nodes. Clipboard, hierarchy,
  revisions, candidates, and persistence continue to operate on node IDs rather than opaque
  component blobs.
- Canvas rendering declares one of three manifest strategies instead of guessing from an export:
  simple controls mount the real shadcn component, validated compounds mount a real nested tree,
  and context-dependent/headless entries use a visible editor fallback while remaining insertable,
  editable, and projectable. Card, Alert, Avatar, Table, Tabs, Dialog, Sheet, Select,
  Dropdown Menu, and Navigation Menu have validated native compositions. Sidebar, Data Table,
  and other compounds without a validated default tree are conservative fallbacks, not claimed as
  interactive Preview integrations.
- Edit and Preview are the only editor modes. Explicit AI invocation, progress, ghost review,
  partial decisions, comparison, and fidelity controls live alongside the canvas selection.

## Persistence and compatibility

1. Read existing v2 projects with their accepted scene content, revisions, candidates, and events.
2. Archive legacy local/fallback run metadata during migration without exposing it as a current
   provider.
3. Add optional component-part and slot metadata without invalidating older component bindings.
4. Keep frame fidelity and node overrides authoritative; descendants inherit the closest frame
   value unless they carry an explicit override.

## Validation order

1. Provider and migration fixtures.
2. Full component-directory manifest coverage and prop/slot validation.
3. Nested component creation, candidate dependencies, acceptance, clipboard, and replay.
4. Inline editor interactions and fidelity navigation.
5. Formatting, Svelte diagnostics, unit tests, production build, then browser QA.

The pre-migration baseline has one known formatting failure in the historical
`prompts/codesign-new-interaction-codex-prompt.md`; product code otherwise starts from the tested
`a2ad5b3` branch head.
