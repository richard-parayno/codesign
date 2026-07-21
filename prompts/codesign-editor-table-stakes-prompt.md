# Codex prompt: Codesign editor table stakes

Before continuing the AI interaction work, improve the table-stakes canvas/editor experience. The goal is not to clone all of Figma, but the editor should feel predictable enough that normal UI-design actions do not interrupt the designer’s flow.

Inspect the existing architecture first and preserve working behavior. Implement these actions through the existing typed operation/history model—not as one-off DOM state—so they support undo/redo, persistence, provenance, nested frames, and future audit trails. Work in the current task worktree and validate any delegated/subagent changes before integration.

## Clipboard and duplication

- `Ctrl/Cmd+C` and `Ctrl/Cmd+V` copy and paste selected elements.
- `Ctrl/Cmd+X` cuts selected elements.
- `Ctrl/Cmd+D` duplicates the selection.
- Paste and duplicate must deep-copy descendants, generate new stable IDs, preserve relative layout/style/component bindings, offset the new selection slightly, and select the new copies.
- Copy/paste should work across frames and local Codesign projects where practical.
- Do not intercept these shortcuts while the user is editing text or typing into an input.

## Modifier-based manipulation

- `Alt/Option+drag` duplicates the dragged selection and shows a preview while dragging.
- `Alt/Option+resize` resizes symmetrically from the center, including edge and corner handles.
- `Shift+resize` preserves aspect ratio.
- `Shift+drag` constrains movement to the dominant axis.
- Modifier combinations such as `Alt+Shift+resize` should behave consistently.
- Space-drag pans the canvas without changing the active tool.

## Selection and geometry

- Support click selection, Shift-click additive/toggle selection, and marquee selection on empty canvas.
- Multi-selected elements should move together and expose one collective bounding box.
- Arrow keys nudge by 1px; Shift+arrow nudges by 10px.
- Show live width, height, and position while moving/resizing.
- Add snapping and visible smart guides for parent/sibling edges, centers, and consistent spacing. Snapping should not cause elements to jump unexpectedly.
- Undo/redo should treat each completed drag, resize, paste, duplicate, reparent, group, or property edit as one atomic action—not every pointer-move event.

## Frames and hierarchy

- Frames are real containers: moving a frame moves its descendants, and deleting/duplicating it handles descendants correctly.
- Dropping an element into a frame reparents it to the topmost eligible frame under the pointer.
- Dragging an element outside its frame removes it from that frame hierarchy.
- Reparenting must preserve the element’s apparent absolute canvas position so it does not visually jump on drop.
- The Layers panel must reflect nesting and allow drag-to-reorder and drag-to-reparent with a clear insertion indicator.
- Add a frame `Clip content` toggle.
- Prevent invalid hierarchy cycles, such as dropping a frame into one of its descendants.

## Grouping and layer order

- `Ctrl/Cmd+G` groups the current selection; `Ctrl/Cmd+Shift+G` ungroups it while preserving canvas position.
- Support Bring forward, Send backward, Bring to front, and Send to back through shortcuts and the context menu.
- The context menu should expose Cut, Copy, Paste, Duplicate, Delete, Group/Ungroup, layer ordering, and relevant frame actions.

## Visual and text properties

- Every applicable element can edit fill, stroke, stroke width, opacity, and corner radius.
- Text elements can edit text content, text color, font size, weight, alignment, and line height.
- Double-clicking text enters inline text editing; `Esc` exits without triggering canvas shortcuts.
- Property changes should work with multi-selection and communicate mixed values clearly.
- Component instances should use permitted overrides/tokens rather than bypassing the component registry.

## Frame creation and presets

- When creating a frame, offer useful named presets plus Custom size. At minimum include:
  - Web / Desktop: `1440×1024`
  - Desktop compact: `1280×832`
  - MacBook Air: `1440×900`
  - MacBook Pro: `1512×982`
- Presets only establish the initial size; frames remain freely resizable.
- Show the preset name and dimensions during creation, allow portrait/landscape swapping where relevant, and remember the most recently used frame size.
- Keep the preset model extensible for mobile, tablet, presentation, and user-defined presets later.

## Discoverability and polish

- Keep keyboard shortcuts available on Windows/Linux and macOS using the appropriate Ctrl/Cmd labels.
- Show shortcuts in tooltips and context-menu items.
- Keep cursor states, selection outlines, handles, hover states, and drag previews visually consistent.
- `Esc` should cancel an in-progress draw/drag/resize/duplicate or clear the current transient mode before clearing selection.
- Delete/Backspace deletes selected canvas elements but must not interfere with text/input editing.
- Preserve sensible selection and focus after every operation.

## Validation

Add reducer/model tests for deep duplication, clipboard serialization, hierarchy changes, cycle prevention, grouping, z-order, frame descendant behavior, and atomic undo/redo. Add focused interaction tests where practical.

Then run formatting, Svelte checks, tests, and production build through `devenv`. Exercise the interactions manually in the browser, including nested frames, multi-selection, modifier combinations, text editing, undo/redo, reload persistence, and context-menu parity. Inspect the actual diff and validate subagent work rather than relying on summaries.

Do not continue to the next AI feature until these editor interactions are real, integrated, and verified. Report what was completed, deliberate deviations from Figma behavior, remaining limitations, and exact verification results.
