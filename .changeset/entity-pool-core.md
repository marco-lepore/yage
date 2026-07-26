---
"@yagejs/core": minor
---

`EntityPool` reuses a fixed group of entities instead of spawning and destroying one per shot. Members are built once and cycled by deactivation, so their physics bodies, display objects and component instances stay allocated between lives.

- `new EntityPool(scene, Bullet, options)` with `acquire` / `forceAcquire` / `release` / `releaseAll` / `dispose`, and `size` / `leased` / `free` counters. Options: `prewarm`, `maxSize`, `reclaimPriority`, and the entity's `setup` params when its `setup()` requires them.
- A pooled class declares `onAcquire(...)`, whose parameters become `acquire`'s arguments; `onRelease()` is optional. Both are hooks on `Entity`, and the pool's generic constraint rejects a class that declares no `onAcquire`.
- Elastic by default: the pool grows and `acquire` returns the entity. With `maxSize` a saturated `acquire` returns `undefined` — and the return type widens to match — while `forceAcquire` reclaims the lowest-`reclaimPriority` member in flight, default oldest-acquired.
- Pool members are built dormant, so they never join a query or fire an enable hook on the way in. Children a member's `setup()` spawns inherit that.
- `entity.isPooled` marks a member so the save layer can skip it, and pools register with their scene: scene exit disposes them, and a disposed pool throws on `acquire`.
- A pool owns its members' lifetimes. `entity.destroy()` on a member returns it to its pool rather than tearing it down, so a collision handler or update holding a plain `Entity` can retire it without a pool reference, and the same code works whether or not the entity is pooled. Destroying an entity that has a member below it detaches and returns that member. `isDestroyed` stays `false` for a released member, and only `dispose()` destroys members.
- `scene.deferPoolReleases(fn)` holds releases for the duration of a batch of queued entity events, so a member released inside the batch rejoins the pool only once the batch finishes and events for its previous life cannot reach a reacquired one.
- `Scene` exports `SetupParamTuple`, the `setup()` parameter tuple the spawn and pool signatures are derived from.
