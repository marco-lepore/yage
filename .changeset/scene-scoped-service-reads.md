---
"@yagejs/core": patch
---

`Scene.use(key)` and `Scene.service(key)` are public, so a scene-scoped service resolves from anything holding a scene reference — an entity's `setup()`, a helper function that takes a `scene`, an addon — and not only from inside the scene subclass.

Both stay scope-aware: scene scope first, then engine scope, with `use` throwing when the key resolves nowhere and `service` deferring resolution to the first property access. `Scene.tryResolveScoped(key)` keeps its no-fallback, never-throwing contract for systems that iterate scenes. Calling `use()` before the scene has an engine context — from a subclass constructor, or on a scene that was never pushed — now throws a named error saying the context arrives when the scene is pushed, instead of failing inside the engine.

A field assigned from `scene.service(key)` is skipped by `Inspector.getComponentData` the way a `Component.service(key)` field already is, so reflecting a component no longer resolves the service behind such a field.
