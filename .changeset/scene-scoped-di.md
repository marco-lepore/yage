---
"@yagejs/core": minor
"@yagejs/renderer": minor
"@yagejs/physics": minor
"@yagejs/debug": patch
"@yagejs/ui": patch
"@yagejs/particles": patch
"@yagejs/tilemap": patch
"create-yage": patch
---

Add scene-scoped DI and generic scene hooks.

**`@yagejs/core`**

- `ServiceKey` now accepts a `{ scope: "scene" }` option. Scene-scoped services are registered per-scene (via `beforeEnter` hooks) and automatically cleared when the scene exits.
- New `SceneHooks` interface (`beforeEnter` / `afterExit`) and `engine.registerSceneHooks(hooks)` API for plugins to set up and tear down per-scene state.
- `Component.use(key)` resolves scene-scoped keys against the active scene's service map automatically.

**`@yagejs/renderer`**

- `SceneRenderTreeKey` is now scene-scoped. `SceneRenderTree`, `SceneRenderTreeProvider`, and `LayerDef` are new public exports.

**`@yagejs/physics`**

- New `PhysicsWorldKey` (scene-scoped) is now exported. Components should use `this.use(PhysicsWorldKey)` instead of `this.use(PhysicsWorldManagerKey).getOrCreateWorld(this.scene)`.
