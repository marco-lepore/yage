---
"@yagejs/core": minor
---

Add opt-in stable entity identity. Pass `{ key }` as the trailing arg to `scene.spawn(...)` or `entity.spawnChild(...)` to register a per-scene identity key, then look the entity up via `scene.findByKey(key)`. Use `entity.requireKey()` inside component `setup()` when the component depends on identity (e.g. reading from a `defineSet<string>` keyed by entity id).

The index is lazy (zero cost when unused), per-scene, hides destroyed entities, and clears on scene teardown. Duplicate keys throw at spawn time without leaving an orphan entity. Identity is independent of `@yagejs/save` — it's a primitive game code threads through stores when state should persist.
