---
"@yagejs/core": minor
---

`Scene.emit` + public `Scene.registerScoped`.

- New `Scene.emit<T>(token, data)` is symmetric to `Entity.emit` — dispatches to scene-level `on` handlers with no entity source. Scene handlers receive `(data, entity?)` where `entity` is `undefined` for scene-emitted events and the source `Entity` for bubbled ones. `Component.listenScene` was updated to mirror the optional `entity` parameter.
- `Scene.registerScoped(key, value)` is now public. Plugins and game code can attach scene-scoped services that resolve via `Component.use(key)`; they're auto-cleared after scene exit (after plugin `afterExit` hooks see them). The underscore-prefixed `_registerScoped` is kept as an internal alias.
