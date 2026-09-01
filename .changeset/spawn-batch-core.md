---
"@yagejs/core": patch
---

`scene.spawnBatch(build)` creates a set of entities that all exist before any of them is set up, and that arrive in the scene together or not at all.

- `batch.reserve(Class, options?)` constructs and keys an entity without running `setup()`, `batch.addChild(parent, name, child)` links two reserved entities before setup so a child can read its parent, and `batch.setup(entity, params?)` runs one entity's `setup()` with the trailing arguments its signature declares. A reserved entity belongs to the scene but stays out of `scene.getEntities()`, `findByKey()`, and every query until the batch commits.
- Commit registers the complete entity and key set before publishing `entity:created` and `component:added` in reservation order, then activates parent-first. Any throw — from `setup()`, a lifecycle-event subscriber, or an `onEnable()` hook — discards the whole batch synchronously, so the same keys can be reserved again immediately. Teardown failures after the first error are reported through `Inspector.getErrors().callbackErrors` and never replace it.
- Inside the callback `entity.spawnChild(...)` joins the batch in every form; a top-level `scene.spawn()` throws, since the batch could not roll it back.
- `SpawnOptions` gains `active`. `scene.spawn(Class, params?, { active: false })` runs `setup()` and every `onAdd()` without firing `onEnable()`, and the entity joins no query until `setActive(true)`. Note that the two-argument `spawn(Class, X)` form now routes an `X` whose only own key is `active` to options rather than to setup params, the way it already does for `key`.
