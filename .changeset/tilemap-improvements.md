---
"@yagejs/tilemap": minor
---

Tilemap DX pass — Tiled-derived auto-keys, asset-handle constructor, ergonomic object lookups.

- New `source: AssetHandle<TiledMapData>` option on `TilemapComponent` — pass the same handle you preload, and the component captures both the parsed data and the asset path. Becomes the default form in docs; `mapKey` and `map` keep working.
- New `tiledObjectKey(prefix, id)` helper plus `tilemap.objectKey(obj)` and `tilemap.forEachObject(layerName, fn)` for spawning entities directly from Tiled objects with stable `entity.key` values like `<mapKey>#object:<id>`. Combine with `scene.spawn(Class, params, { key })` (PR #56) to thread Tiled identity into persistent stores.
- New `keyPrefix` option lets games override the auto-key prefix when running multiple instances of the same map (instanced dungeons, per-floor layouts).
- New direct lookups on `TilemapComponent`: `findObject(id)`, `findObjectByName(name)`, `getAllObjects()`.
- New typed property/ref helpers on the component: `getProperty`, `getPropertyArray`, `resolveRef`, `resolveRefArray`. The ref helpers walk every object layer for you so callers don't have to gather a pool first.
- The dungeon `tilemap` example now drives the player and enemies from the Tiled object layer using the new auto-key path; the debug overlay visualises walls, spawn points, and `EnemySpawnController`-to-spawn wiring resolved via `resolveRefArray`.
