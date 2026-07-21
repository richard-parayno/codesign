# Codesign demo script — under three minutes

## Primary path

**0:00–0:20 — Establish direct control.** Open the app, sketch a few rough layers inside a frame, and add a useful frame/group name or text label. Point out that the canvas remains fully editable before, during, and after AI assistance.

**0:20–0:40 — Choose an explicit boundary.** Select a group, frame, or a layer contained by one. Open **Scope** and compare **Selection** with **Same parent frame**. The target boundary shows what may change; purple dashed outlines show the additional layers Codex may inspect as context.

**0:40–1:05 — Opt in to visual autocomplete.** Open **Codesign with AI**. Show that **Base** cannot generate, move to **AI Draft**, and confirm the generation. The selected target glows while the request is active, and the live source remains unchanged while Codex builds a copy-on-write candidate.

**1:05–1:35 — Review native changes.** Inspect the candidate as editable layers, open **Review**, and toggle individual dependency-safe changes. Use **Compare source** when useful, then accept all changes or the selected subset.

**1:35–2:00 — Increase fidelity.** Reopen **Codesign with AI**, move to **AI Hi-Fi**, and confirm. Explain that compatible shadcn-svelte components are used when available and that accepted high-fidelity output creates or updates a reusable local component definition.

**2:00–2:25 — Reroll without losing history.** Reroll the current fidelity, review the alternative, and open **Element History** to show the saved variations. Accept or reject the result; ordinary canvas edits remain available afterward.

**2:25–3:00 — Show the safety boundary.** Open Settings to show the local Codex status. Close with: “Codesign suggests scoped, native continuations; the designer decides which structured changes become part of the design.”

## Codex availability

Codesign uses a separately installed and authenticated Codex CLI. Before presenting live AI generation, run `pnpm run doctor` and confirm it ends with **Codesign is ready.** If Codex is missing or signed out, the editor still starts and remains explorable; the status explains how to restore AI completion without fabricating a candidate.

## Preflight

1. Use a 1440×900 browser window at 100% zoom.
2. Run `pnpm install --frozen-lockfile`, then `pnpm run doctor`.
3. Run `pnpm dev --open`; keep the development server on its default loopback host.
4. Exercise AI Draft, AI Hi-Fi, partial acceptance, rejection, same-fidelity reroll, source comparison, Element History, and reload persistence.
5. Confirm project switching still works and the SvelteKit terminal shows `[codesign:action]` records.
6. Reset to a simple rough canvas before presenting.
