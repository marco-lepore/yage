---
"@yagejs/core": minor
---

`entity.handle()` gives a reference that expires with the entity's current life, so code holding on to an entity someone else retires can tell that it is gone. A pooled entity is reused, and a released member is alive with `isDestroyed` still `false`, so a plain stored reference silently follows the object into its next life — a turret keeps tracking what is now a different enemy.

- `entity.handle()` returns an `EntityHandle<T>`, read through `.current`: the entity while that life lasts, `undefined` afterwards. `EntityHandle` is a type; `handle()` is the only way to make one.
- `.current` means "the same life", not "active right now" — an entity switched off with `setActive(false)` still resolves.
- A life ends on `destroy()`, on scene teardown, on every path that returns a pool member (`release`, `releaseAll`, a `forceAcquire` reclaim), and on `dispose()`, which destroys the members. A member's descendants end their lives with it.
- `entity.generation` is the counter behind it: per entity, 0 to start, increased whenever a life ends. Compare it for equality — a destruction cascade can advance it more than once, so it does not count lives. It stays out of save and Inspector snapshots.
- `handle()` on a pool member the pool is not lending out returns a handle that never resolves, and warns in dev builds — the caller only has a stale reference at that point.
- Guidance: use a handle whenever pooled entities are involved; a plain reference is fine for entities that live as long as the scene, or when the code storing the reference also controls when the entity goes away.
