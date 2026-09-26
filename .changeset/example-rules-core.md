---
"@yagejs/core": patch
---

The README sample and the JSDoc show the recommended patterns: the README marks `Blueprint` deprecated and puts the sample's logic in a component, the `EntityPool` example creates its pool in a component's `onAdd()`, and `Scene.registerScoped` no longer suggests it for game state. `ProcessSlotConfig.loop` notes that a looping slot never completes, so its `onComplete` never runs; loop a `Sequence` for a repeating callback.
