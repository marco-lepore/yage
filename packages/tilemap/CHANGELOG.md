# @yagejs/tilemap

## 0.10.3

### Patch Changes

- [#272](https://github.com/marco-lepore/yage/pull/272) [`c3d4459`](https://github.com/marco-lepore/yage/commit/c3d4459b6e73971b93aa81bad60d7625b5280092) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Tiles are anchored the way Tiled draws them, and a tile object keeps the tile it draws.
  - Every tile image is anchored to the bottom-left of its cell, whatever its size: one taller than the map's grid overhangs upward, a wider one to the right, and one smaller than the grid sits on the cell's bottom edge. Tiles occupied the top-left of their cell before, which drew a tall prop one or more cells too low and a small one too high. A collection-of-images tileset measures each tile's own image, so tall and short props in one tileset both land correctly — a tile smaller than the grid moves down even when the tileset's declared tile size matches the grid, because that size records only the largest image in the collection. A single-image tileset whose tile size equals the grid is unaffected.
  - `MapObject.gid` (and the raw Tiled `TileObject.gid`) carries the global tile ID of an object that draws a tile, flip bits included — split them with `readTileGid`. It is absent on every other object type.
  - A tile object's `x`/`y` is normalised to its top-left corner, honouring the owning tileset's `objectalignment` and the object's own rotation, so `getObjects()`, `findObject()`, `getCollisionShapes()`, `toPhysicsColliders()` and spawn code all place it where Tiled shows it. A game that compensated for the old coordinates by hand — `obj.y - obj.height` or similar — should drop that adjustment. Every other object type is untouched.
  - `validateTiledMap()` reports a `tile-object` error per object layer, naming the tile objects whose images are not drawn.

  Collision shapes authored on a tile inside the tileset are not read — a tile object's collider is its whole box — and a tile object's image is not drawn, so you spawn the sprite yourself from its `gid`.

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`6dc493e`](https://github.com/marco-lepore/yage/commit/6dc493e32c8a20e928621490c1308f99324e7208), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3
  - @yagejs/renderer@0.10.3

## 0.10.2

### Patch Changes

- [#259](https://github.com/marco-lepore/yage/pull/259) [`7002ce8`](https://github.com/marco-lepore/yage/commit/7002ce8d35e7a10c384496fcef166884fed5e0b4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Carry through the parts of a Tiled map the package used to drop, and report the forms it cannot render.
  - Custom properties now survive conversion for the map, each tile layer, each object layer and each tileset, so a map can carry its own biome, music track or level index without a marker object. `TilemapData` gains `properties` and a `tilesets: TilesetInfo[]` list, and `getProperty` / `getPropertyArray` / `resolveRef` / `resolveRefArray` accept anything with a `properties` array.
  - `validateTiledMap()` reports the Tiled features this package does not render: isometric maps, infinite and chunked maps, base64-encoded layer data, group layers, image layers, `.tsx` tileset references, parallax, and tile animations it cannot play. The same list is on `TilemapData.diagnostics`, and `TilemapComponent` logs it once per map. A group layer and its nested layers were previously skipped with no signal at all.
  - `getObjectGroups()` and `extractObjectGroups()` return `{ layer, class, objects }` records. Two layers holding the same class stay separate, and a classless object is grouped under its layer rather than keyed by its name. `getObjects()` and `extractObjects()` are unchanged.
  - A map with an embedded tileset loads. The loader treats a source-less tileset reference as its own data instead of skipping it, which previously made such a map fail at the first tile with `Could not resolve texture for tile GID 1 in tileset "undefined"`.
  - `TilemapComponent` extends the renderer's `VisualComponent`, so it takes `tint`, `alpha`, `blendMode`, `visible` and `interactive` options and exposes `.fx` and `setMask`. Tint and alpha are applied through a colour filter on the map container, because the tile shader has no colour input; an untinted, fully opaque map attaches no filter. The snapshot gains the shared visual fields.
  - Tiled draw offsets are applied: a tileset's `tileoffset` and a layer's `offsetx`/`offsety` shift tile placement, object-layer offsets shift the object coordinates that feed collision extraction and spawns, and `getTileAt` reads each layer through its own offset.
  - A layer hidden or faded in Tiled renders that way: `createTilemapLayers` honours per-layer `visible` and `opacity`.
  - A single-image tileset renders when it also carries a `tiles[]` array. Tiled writes that array as soon as one tile has an animation, class, custom property or collision shape, and such a tileset was treated as a collection-of-images and threw at the first tile.
  - Tile animations authored in Tiled play, with no component option or per-frame game code. The clock comes from the scene, so pause and `timeScale` apply. An animation plays when its tileset is a single image, its frames are equal-duration, and they sit a constant distance apart in that image — the shape Tiled's animation editor produces by default. Anything else renders unanimated, as the tile the map places, and reports an `unsupported-tile-animation` warning naming the tile and the reason. The animation phase is not saved; a restored tilemap starts its cycle from zero.
  - Flipped and rotated tiles render in the orientation Tiled shows, across all eight combinations of its horizontal, vertical and diagonal flips. A single flipped tile previously made the whole map fail to load with `No tileset found for tile GID 2684354561`, because the flip bits were read as part of the tile id. `getTileAt` returns the id with those bits removed, and `readTileGid` splits a raw GID from `TilemapData` into its id and orientation.

- Updated dependencies [[`97ace87`](https://github.com/marco-lepore/yage/commit/97ace87237bc63accd0b0ffb840e03c51a2bb5b6), [`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9), [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372), [`b29d234`](https://github.com/marco-lepore/yage/commit/b29d2342218cc899a3d286f964bb7876f81ae49d), [`7002ce8`](https://github.com/marco-lepore/yage/commit/7002ce8d35e7a10c384496fcef166884fed5e0b4)]:
  - @yagejs/renderer@0.10.2
  - @yagejs/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1
  - @yagejs/renderer@0.10.1

## 0.10.0

### Minor Changes

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `TilemapComponent` hides its rendered layers while the entity is dormant and shows them again on reactivation.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203), [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd)]:
  - @yagejs/core@0.10.0
  - @yagejs/renderer@0.10.0

## 0.9.0

### Minor Changes

- [#168](https://github.com/marco-lepore/yage/pull/168) [`3d7d69e`](https://github.com/marco-lepore/yage/commit/3d7d69ee94ea1dc4db7b2369127cb3b36eb53556) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Tiled collision-shape extraction and physics/debug correctness fixes, plus collider rotation support.
  - Object rotation is honored during collision extraction (it was previously ignored): polygon, polyline, and sampled-ellipse vertices come out rotated; a rotated circle's position shift is baked into `x`/`y`; rect and capsule configs carry a new optional `rotation` (radians) that `toPhysicsColliders` forwards to the physics collider, with the center offset rotated about the Tiled pivot.
  - Tiled polygon objects now emit a closed polyline: the first vertex is appended at the end, so the boundary's closing edge collides instead of leaving a gap.
  - Non-circular Tiled ellipses are approximated with a 24-vertex convex polygon instead of collapsing to a circle with the wider radius. Circular ellipses still emit an exact `circle`.
  - Tiled polyline objects are now extracted as open polyline colliders (previously they fell through to a degenerate 0×0 rect). `MapObject` carries the new optional `polyline` vertex list.

- [#178](https://github.com/marco-lepore/yage/pull/178) [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Unify the five visual components' options, delete the raw-texture escape
  hatches, and stop leaking raw `pixi.js` types from public signatures.
  - `TilemapComponent.container` is now typed as `@yagejs/renderer`'s
    `DisplayContainer` alias instead of a raw `pixi.js` import. Type-only
    change — the field still holds the real Pixi `Container`.

### Patch Changes

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - `TilemapComponent` declares priority 50, keeping it inside the engine band so it restores before undeclared game components.

- Updated dependencies [[`a5c8be9`](https://github.com/marco-lepore/yage/commit/a5c8be9527ce31a5a8f0ce6b6d94a830d2322c83), [`c62453b`](https://github.com/marco-lepore/yage/commit/c62453b48a5f5dbebdb26c6bab495cc7d5b64195), [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22c05c8`](https://github.com/marco-lepore/yage/commit/22c05c8a561d6361ca3489eaa2d0a0ea5caf2492), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`3fbbe3d`](https://github.com/marco-lepore/yage/commit/3fbbe3d3c936f636d5069e296a4ca228b7511c86), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667), [`0735a9a`](https://github.com/marco-lepore/yage/commit/0735a9a3a1fa6e3f7b8549887b9b87d43674df98), [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955)]:
  - @yagejs/renderer@0.9.0
  - @yagejs/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`cc29414`](https://github.com/marco-lepore/yage/commit/cc29414877a074688a411d93f7ecf6781ca82ea2), [`2982d21`](https://github.com/marco-lepore/yage/commit/2982d21facc865261e258ee02dc6b8000f226e9f), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d), [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`cafa74c`](https://github.com/marco-lepore/yage/commit/cafa74cbe90ec1143c60dcfd782a0a76c8d859dd), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0), [`68e7243`](https://github.com/marco-lepore/yage/commit/68e72436209f7e03f0e8ad0bde94f3d23562bcbe)]:
  - @yagejs/core@0.8.0
  - @yagejs/renderer@0.8.0

## 0.7.0

### Minor Changes

- [#68](https://github.com/marco-lepore/yage/pull/68) [`903b2b9`](https://github.com/marco-lepore/yage/commit/903b2b9539015e8109f0bb456ba75811ad8fba4f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - feat(tilemap): capsule/ellipse + concave-polygon collider support

  **Tiled shape coverage.** `extractCollisionShapes` / `toPhysicsColliders`
  now branch on the `ellipse` and `capsule` flags Tiled writes on object
  instances; previously those silently fell through to the default
  rectangle path and produced wrong AABB hitboxes. Ellipses become
  `circle` colliders (with a dev-warning fallback when `width !== height`,
  since Rapier has no real ellipse primitive); capsule objects become
  `capsule` colliders oriented along the longer axis.

  **Concave polygons via polyline.** Tiled polygons are authored as
  outlines, not solid hulls, so `toPhysicsColliders` now emits them as
  the new `shape: "polyline"` variant (chain of line segments). Unlike
  `shape: "polygon"`, polylines preserve concave detail — at the cost of
  being static-only (no inertia computed). The existing convex `polygon`
  path now logs a dev warning when the input vertex list is concave, so
  the silent convex-hull widening can't return.

  **Breaking — `TilemapColliderConfig` types.** `extractCollisionShapes`
  previously returned `RectColliderConfig | PolygonColliderConfig`; it
  now also returns `CircleColliderConfig`, `CapsuleColliderConfig`, and
  `PolylineColliderConfig` (and Tiled polygons map to `polyline` rather
  than `polygon`). Code that exhaustively switches on the `type` field
  needs new arms for `"circle"`, `"capsule"`, `"polyline"`, and should
  treat the existing `"polygon"` case as covering only pre-converted
  convex hull data.

  **Breaking — `ColliderShape` adds `polyline` + `axis`.** The physics
  `ColliderShape` discriminated union gains a `polyline` variant and the
  `capsule` variant gains an optional `axis: "x" | "y"` field (default
  `"y"`, matching previous behavior).

### Patch Changes

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Guard the Tiled tileset subtexture cache against duplicate keys, and key cache entries on the tileset image path.
  - `tiledMapLoaderParser` called `Assets.cache.set(cacheKey, subtex)` unconditionally for every tile on every load — re-loading the same map (or two maps that share a tileset) triggered Pixi's `[Cache] already has key` warning and re-allocated subtextures the cache already held. The loader now skips both the `Texture` construction and the `cache.set` when the key already exists.
  - The subtexture cache key now derives from the tileset's image path rather than its user-supplied display name, so two tilesets that happen to share a name can't silently return one another's subtextures. The loader and `parseTiledMap` share a `subtextureCacheKey()` helper to stay in lock-step.
  - Documented the JSON-tileset requirement: tilesets must be exported from Tiled as JSON (`.tsj` / `.json`); the default `.tsx` XML format isn't supported by the loader.

- [#66](https://github.com/marco-lepore/yage/pull/66) [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix tilemap drift when a sibling layer renders a filter (`hitFlash`, `bloom`, etc.). `TilemapPlugin.install` now runtime-patches `@pixi/tilemap`'s `TilemapPipe.execute` to read the currently-bound uniform group instead of `renderer.globalUniforms._activeUniforms.at(-1)` (which is the per-frame push log and stays populated after a filter pops, so subsequent tilemap draws were picking up the filter's leftover `uWorldTransformMatrix`). The patch also swaps `tilemap.worldTransform` for `tilemap.groupTransform` to match what Pixi's own `SpritePipe` / `GraphicsPipe` do — Pixi populates `worldTransform` as `parentRG.worldTransform × relativeGroupTransform` when the tilemap sits inside a sub-render-group, so combining it with `uWorldTransformMatrix` would double-apply the camera + fit transform.

  The patch is applied once in `TilemapPlugin.install` and is idempotent. Targets `@pixi/tilemap@5.0.2`; the dependency is now pinned to that exact version so a transparent minor bump can't silently change the pipe shape under us.

- Updated dependencies [[`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`8d80f18`](https://github.com/marco-lepore/yage/commit/8d80f1856ac897e8dcaa28543d57ff16750e97f3), [`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`0e9f86c`](https://github.com/marco-lepore/yage/commit/0e9f86cc42bb632d38a67c22aa31b6dd21cf82e7), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/renderer@0.7.0
  - @yagejs/core@0.7.0

## 0.6.0

### Minor Changes

- [#59](https://github.com/marco-lepore/yage/pull/59) [`9a2519b`](https://github.com/marco-lepore/yage/commit/9a2519ba9ed739cacc116699fc2944eb54930e23) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Tilemap DX pass — Tiled-derived auto-keys, asset-handle constructor, ergonomic object lookups.
  - New `source: AssetHandle<TiledMapData>` option on `TilemapComponent` — pass the same handle you preload, and the component captures both the parsed data and the asset path. Becomes the default form in docs; `mapKey` and `map` keep working.
  - New `tiledObjectKey(prefix, id)` helper plus `tilemap.objectKey(obj)` and `tilemap.forEachObject(layerName, fn)` for spawning entities directly from Tiled objects with stable `entity.key` values like `<mapKey>#object:<id>`. Combine with `scene.spawn(Class, params, { key })` (PR [#56](https://github.com/marco-lepore/yage/issues/56)) to thread Tiled identity into persistent stores.
  - New `keyPrefix` option lets games override the auto-key prefix when running multiple instances of the same map (instanced dungeons, per-floor layouts).
  - New direct lookups on `TilemapComponent`: `findObject(id)`, `findObjectByName(name)`, `getAllObjects()`.
  - New typed property/ref helpers on the component: `getProperty`, `getPropertyArray`, `resolveRef`, `resolveRefArray`. The ref helpers walk every object layer for you so callers don't have to gather a pool first.
  - The dungeon `tilemap` example now drives the player and enemies from the Tiled object layer using the new auto-key path; the debug overlay visualises walls, spawn points, and `EnemySpawnController`-to-spawn wiring resolved via `resolveRefArray`.

### Patch Changes

- Updated dependencies [[`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`47ffab6`](https://github.com/marco-lepore/yage/commit/47ffab6b37423155f92e97519b66b73e14b73039), [`9a2519b`](https://github.com/marco-lepore/yage/commit/9a2519ba9ed739cacc116699fc2944eb54930e23), [`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`d9be1b3`](https://github.com/marco-lepore/yage/commit/d9be1b365ae83a8ca365d72003ec23e6fbb8679f), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/renderer@0.6.0
  - @yagejs/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/renderer@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`08efa94`](https://github.com/marco-lepore/yage/commit/08efa94a8be02ba56c1df9d3bed643abcc1d7159)]:
  - @yagejs/renderer@0.4.0
  - @yagejs/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4)]:
  - @yagejs/core@0.3.0
  - @yagejs/renderer@0.3.0

## 0.2.0

### Patch Changes

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - `TilemapComponent` resolves its layer through `SceneRenderTreeKey` (scene-scoped) instead of the removed `RenderLayerManagerKey`.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/core@0.2.0
