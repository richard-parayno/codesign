# Codesign demo script — under three minutes

## Primary path

**0:00–0:15 — Establish direct control.** Open the app and click **Reset to blank** if needed. Draw a frame with `F`, or use **Load demo checkpoint** for the reliable path. Point out that `Edit`, `Co-design`, and `Preview` are separate modes.

**0:15–0:35 — Choose an explicit boundary.** Select one frame or region, then enter **Co-design**. Nothing generates yet. Show **Can change** with its solid canvas outline. Change **Can reference** from Selection to Containing frame or Page and show the lighter dashed observational boundary.

**0:35–0:55 — Request visual autocomplete.** Choose **Complete pattern**. The deterministic local generator returns structured candidates. The source is unchanged; the continuation appears as native ghost rectangles and text on the canvas.

**0:55–1:25 — Review evidence and atomic changes.** Switch between candidate tabs. Highlight one change and open **Review derivation trace**. Read the objective Observed, Context, Codesign proposed, Change, and Decision fields. Use **Compare with source**, then return to the candidate.

**1:25–1:50 — Make a partial decision.** Leave two changes checked and uncheck one. Dependencies are included automatically. Choose the visible partial-accept action. The selected operations land in one revision; the unselected change is retained as rejected in **Process history**.

**1:50–2:10 — Reject and revisit.** Generate again, reject a candidate, open **Process history**, and use **View candidate** or **Compare with source**. Rejection does not delete the candidate.

**2:10–2:30 — Pin and reroll.** Generate another candidate, pin one proposed atomic change, then choose **Reroll unpinned changes**. The earlier candidate remains switchable, and the rerolled candidate carries the pinned change while varying the rest.

**2:30–2:45 — Show fidelity without fake controls.** Point out the named Structure, Wireframe, Component, Visual, and Production stops. Each has a textual state. Unsupported Visual and Production stops are descriptive, not clickable.

**2:45–3:00 — Preserve normal design work.** Return to **Edit**, adjust geometry or appearance, duplicate a screen, and enter **Preview**. Close with: “Codesign suggests visible continuations; you decide which structured changes become part of the design.”

## Deterministic fallback

Click **Load demo checkpoint**, select the main frame, enter **Co-design**, choose **Containing frame**, then **Complete pattern**. This path is fully local and should not require authentication, network access, or credits.

If the optional Codex backend is signed out, slow, or returns invalid output, the API reports a local fallback and the same candidate review flow continues. Do not troubleshoot authentication during a presentation.

## Preflight

1. Use a 1440×900 browser window at 100% zoom.
2. Run `devenv shell -- pnpm dev --host 0.0.0.0`.
3. Keep `CODESIGN_AGENT_BACKEND=local` for the deterministic demo.
4. Load the checkpoint once and exercise Complete, partial acceptance, reject, pin/reroll, source compare, and reload.
5. Confirm project switching still works and the SvelteKit terminal shows `[codesign:action]` records.
6. Reset to blank before presenting if you want to demonstrate the empty starting state.
