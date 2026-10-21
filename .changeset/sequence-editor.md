---
"@yagejs-tools/editor": patch
---

Add authored keyframe sequences and the editor's Sequence mode.

- Sequence mode animates declared project entities in the level editor's preview. It uses the same parameter inspector, asset loading, transform tools, draft saving and undo history as level editing. A resizable keyframe timeline sits under the preview.
- The `sequences` config field lists globs of sequence workspace files. A config that lists sequences can leave out `levels`.
- Moving, rotating or scaling an actor, with the transform tools or the transform fields, keys that property at the cursor frame. Scrubbing, and dragging keys or event markers, update the preview continuously. Each release is one undo step.
- Each actor has a runtime slot and a contract. A new actor's contract declares the six properties the sequence addon's transform and visual targets provide. The contract editor adds typed properties, events and payload fields.
- The timeline edits typed key values and easing, including cubic Bézier curves with a curve preview. It supports zoom, track removal and moving several keys at once.
- **Files** imports a runtime clip and exports the runtime clip or the whole workspace. An invalid import leaves the document unchanged.
