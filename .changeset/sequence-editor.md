---
"@yagejs-tools/editor": minor
---

Add authored sequence playback and editing.

- Add Sequence mode with a persistent preview and resizable keyframe timeline.
- Use declared project entities and the existing parameter inspector, asset loading and transform tools for actor previews. Replace preview types without losing runtime slots or animation.
- Save sequence workspaces through the shared draft and undo pipeline. Transform gestures create keys at the cursor; key dragging and scrubbing update the preview continuously.
- Preview proportional or anchored positions, curves, opacity and event markers. Runtime clips remain independent of editor placements and bind to game entities at play time.
- Add typed value and contract controls, event payload editing and dragging, track removal, timeline zoom, and runtime clip/workspace file exports. Imports validate first and reject stale file reads.
- Keep unbound preview placements editable, including one-step undo for gestures that also key animated actors.
