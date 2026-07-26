---
"@yagejs/save": minor
---

`entity.handle()` gives a reference that expires with the entity's current life, so code holding on to an entity someone else retires can tell that it is gone.

- `SnapshotResolver.handle<E>(savedId)` resolves a save-time entity id to a handle on the restored entity, the counterpart of `resolver.entity(savedId)` for references held as handles. Serialize the target's id (`this.target?.current?.id ?? null` — an explicit `null` survives a JSON round trip, a missing key does not) and restore with `resolve.handle(data.targetId)`.
- It returns `undefined` when the id is `null` or not in the snapshot, which covers a reference empty at save time, a target destroyed before the save, and a pool member the snapshot left out.
