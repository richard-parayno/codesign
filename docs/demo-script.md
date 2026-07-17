# Malleable demo script — under three minutes

## Primary path

**0:00–0:10 — Start with nothing.** Open the app and click **Reset to blank** if needed. Point out `Local` and `Guide`: the demo is offline and the agent is constrained.

**0:10–0:40 — Sketch.** Press `F` and drag an application frame. Use `R` for a sidebar, header, content region, and four horizontal row shapes. Use `T` for a label if time allows. Shift-click the four rows in the canvas or layer list.

**0:40–0:57 — Bind repetition.** Choose **Repeat?** in the contextual bar. Show the staged proposal: targets, confidence, rationale, scope, and source. Accept. The rows gain confirmed intent and repeat badges. Undo and redo once to show that the semantic action is one operation.

**0:57–1:20 — Make the flow playable.** Click `+` next to Screens to duplicate the current screen. Return to the first screen. Press `C`, click a row, then choose **Connect** beside the second screen. Enter **Preview**, click the connected row, and show that the second state opens. Press Escape or select Edit.

**1:20–1:43 — Promote within a contract.** Select the sidebar or one repeated row and choose **Promote**. Accept the registered `Sidebar`, `DataRow`, or `Card` match. Point out that rough and promoted regions coexist. The model cannot invent a component or token.

**1:43–2:02 — Generalize a direct edit.** With a promoted repeated row selected, open Design in the right inspector. Change density to Compact or adjust padding/radius. Choose **Generalize to repeater siblings** and show the explicit propagation in one history entry.

**2:02–2:23 — Inspect intent.** Open Intent. Show Ambiguous, Inferred, and Confirmed totals, then select a node to show its semantic role, commitment, binding, provenance, operation ID, and protection status.

**2:23–2:42 — Show shared IR.** Expand **Operation history**, then **Svelte projection**. Point out agent versus user attribution, registered imports for promoted content, and greybox placeholders for unresolved content. The projection is generated from the same document as the canvas.

**2:42–2:57 — Explore safely.** Choose **Branch current screen**, change the alternative, then select the Accepted branch’s original screen in the left panel. The original remains unchanged. Alternatively, switch the agency envelope to Explore and accept a proposal; Malleable creates the branch before applying it.

**2:57–3:00 — Close.** “Design the screen; let AI understand what the moves mean.”

## Deterministic fallback

Click **Load demo checkpoint**. This loads a frame, shell regions, and four rows with repetition already confirmed. Continue from duplicate/connect/Preview. The button is intentionally separate from Reset so the default blank-canvas claim remains truthful.

If Codex is signed out, unavailable, slow, or returns invalid output, leave the visible local fallback indicator in place and continue: every critical interaction works through the deterministic adapter. Do not troubleshoot authentication during the three-minute presentation.

## Preflight

1. Use a 1440×900 or 1280×800 browser window at 100% zoom.
2. Run `devenv shell -- pnpm dev --host 0.0.0.0`.
3. For the real-agent variant, run `devenv shell -- codex login status` and set `MALLEABLE_AGENT_BACKEND=codex`; otherwise keep `local`.
4. Load the checkpoint once, exercise duplicate/connect/Preview, then Reset to blank.
5. Confirm the browser has localStorage enabled and no stale error toast is present.
