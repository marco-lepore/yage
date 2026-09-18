---
"@yagejs/core": minor
---

Reject a per-frame method on a `Scene` or `Entity` subclass at compile time.

- Breaking: `Scene` and `Entity` declare `update` and `fixedUpdate` as `never`, so a subclass that defines either name fails to compile. The engine's per-frame pass ticks components, so a method with either name on a scene or an entity is dead code.
- Per-frame logic belongs in a component on the entity, or on an entity the scene spawns. Work that outlives a single entity goes on the queue that `makeSceneScopedQueue()` returns, which pauses and ends with its scene.
- `Scene` declares `onProgress(ratio)`, `onEnter`, `onExit`, `onPause` and `onResume`, and no other hook; `LoadingScene` adds `onLoadError`.
