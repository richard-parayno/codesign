# Codesign demo script — under three minutes

## Primary path

**0:00–0:15 — Establish direct control.** Open the app and click **Reset to blank** if needed. Draw a frame with `F`, or use **Load demo checkpoint** for the reliable path. Point out the familiar **Edit** and **Preview** modes.

**0:15–0:35 — Choose an explicit boundary.** Select one frame or region. Nothing generates yet. Open **Scope** in the contextual toolbar, show the solid mutation boundary, then change the observational scope from Selection to Containing frame or Screen.

**0:35–0:55 — Request visual autocomplete.** Choose **Complete with Codesign**. Codex returns structured candidates. The source is unchanged; the continuation appears as native scene-graph ghosts on the canvas and in Layers.

**0:55–1:25 — Review evidence and atomic changes.** Switch between candidate tabs. Highlight one change and open **Review derivation trace**. Read the objective Observed, Context, Codesign proposed, Change, and Decision fields. Use **Compare with source**, then return to the candidate.

**1:25–1:50 — Make a partial decision.** Open **Review**, leave two changes checked, and uncheck one. Dependencies are included automatically. Accept the visible subset; the unselected change is retained as rejected in **Process history**.

**1:50–2:10 — Reject and revisit.** Generate again, reject a candidate, open **Process history**, and use **View candidate** or **Compare with source**. Rejection does not delete the candidate.

**2:10–2:30 — Pin and reroll.** Generate another candidate, pin one proposed atomic change, then choose **Reroll unpinned changes**. The earlier candidate remains switchable, and the rerolled candidate carries the pinned change while varying the rest.

**2:30–2:45 — Show fidelity in context.** Point out the named Structure, Wireframe, Component, Visual, and Production stops beside the selection and in Properties. Existing representations navigate without destruction; an unrealized forward stop starts a candidate request.

**2:45–3:00 — Preserve normal design work.** Adjust accepted component props, text, and geometry, duplicate a screen, and enter **Preview**. Close with: “Codesign suggests visible continuations; you decide which structured changes become part of the design.”

## Codex availability

Click **Load demo checkpoint**, select the main frame, choose **Containing frame** under **Scope**, then **Complete with Codesign**. Confirm Settings reports that the project Codex runtime is detected and the account is connected before presenting. If Codex is unavailable or signed out, the app reports that state and does not create a candidate.

## Preflight

1. Use a 1440×900 browser window at 100% zoom.
2. Run `devenv shell -- pnpm dev --host 0.0.0.0`.
3. Confirm Codex is connected in Settings.
4. Load the checkpoint once and exercise Complete, partial acceptance, reject, pin/reroll, source compare, and reload.
5. Confirm project switching still works and the SvelteKit terminal shows `[codesign:action]` records.
6. Reset to blank before presenting if you want to demonstrate the empty starting state.
