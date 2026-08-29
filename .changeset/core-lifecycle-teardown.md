---
"@yagejs/core": minor
---

Entity destroy, pool release, and component teardown converge on one model instead of three overlapping ones.

- `destroy()` now deactivates the entity immediately: `isActive` reads `false`, the entity leaves every query, and component `onDisable` fires in the same call — the same as `setActive(false)`. `onDestroy` and detaching from the scene still wait for the end-of-frame flush.
- `EntityPool` release now cancels the member's `ProcessComponent`, so a `Process.delay` or tween scheduled before release no longer survives the park and fires against the next lease.
- Added `Component.destroy()`: ends the component's own life the same as `entity.remove(SomeClass)`, without having to name its own class from inside itself, which broke under subclassing.
- Removed `Component.onRemove` — `onDestroy` is the one teardown hook. `onRemove` always fired alongside `onDestroy` and no component could tell the two apart.
- Removed `Scene.destroyEntity` — a one-line alias for `entity.destroy()`.
- Fixed: a pool member that picked up a parent while leased (via `addChild`) now gets detached before it goes back into the pool, so the next lease never inherits a stale parent.
- Fixed: `_applyActive` no longer propagates a stale activeness value to children when an `onEnable`/`onDisable` hook changes activeness again during propagation.
- Fixed: a `setup()` that throws during `scene.spawn()` is no longer rolled back. The half-built entity, and anything it already spawned, stays in the scene for inspection — matching how a throwing `onAdd` is already handled.
- Fixed: pool disposal during scene teardown now runs after every entity is marked destroyed, not before, so a developer `onRelease` hook no longer observes a scene where some entities are marked and others are not.
- Fixed: an entity spawned by a component's `onDestroy` during scene teardown is now marked destroyed and torn down like every other entity, instead of being gutted without ever being marked.

**Breaking**, all pre-1.0: an entity now leaves queries at `destroy()` instead of at the end-of-frame flush — code that assumed an entity stays queryable until the flush needs to account for the gap. A component overriding `onRemove` must rename it to `onDestroy`. Code calling `scene.destroyEntity(entity)` must call `entity.destroy()` instead. A game relying on a scheduled process surviving pool release must reschedule it in `onAcquire`. `Entity.add()` now throws when passed a component instance that was already removed or destroyed — components are terminal, so an instance whose cleanups already ran can no longer be silently re-attached to a different entity. A pool member nested under another pool member no longer receives `onRelease` during scene teardown: the pool is being disposed rather than reused, so the member is torn down through `onDestroy` instead — move any teardown work that lived only in `onRelease`.
