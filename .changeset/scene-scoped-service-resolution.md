---
"@yagejs/core": patch
---

`Scene.service()` and the new `Scene.use()` are now scope-aware, so a scene can resolve its own scene-scoped services (e.g. `SceneRenderTreeKey`, `PhysicsWorldKey`) directly.

- Added `Scene.use(key)`, mirroring `Component.use`: scene scope is checked first, then engine scope. Previously `Scene.service()` resolved only against the engine context, so scene-scoped keys were unreachable from `onEnter` and game code had to fall back to the near-identical provider key.
- A scene-scoped key that resolves only at engine scope now logs a warning (likely a plugin missing its `beforeEnter` registration), and an unresolved scene-scoped key throws a named, actionable error instead of failing opaquely.
- `Scene.service()` delegates to `use()` for lazy field-initializer resolution. Note the proxy caches its first resolved value: prefer `use()` inside `onEnter()` for scene-scoped keys, since a cached value would go stale across scene exit/re-entry.
