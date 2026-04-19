---
"@yagejs/core": minor
---

pr: 20
commit: 6143e0346820dd74d78b1d345ac4ebc5e4294769
author: marco-lepore

Add scene-scoped DI and generic scene hooks.

- `ServiceKey` now accepts a `{ scope: "scene" }` option. Scene-scoped services are registered per-scene (via `beforeEnter` hooks) and automatically cleared when the scene exits.
- New `SceneHooks` interface (`beforeEnter` / `afterExit`) and `engine.registerSceneHooks(hooks)` API for plugins to set up and tear down per-scene state.
- `Component.use(key)` resolves scene-scoped keys against the active scene's service map automatically.
