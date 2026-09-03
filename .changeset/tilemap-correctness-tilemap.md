---
"@yagejs/tilemap": minor
---

A map answers and draws where its tiles are, and a map with one bad tileset or one bad tile still renders.

- An external tileset's `image` resolves against the tileset file's own folder,
  which is the path Tiled writes there. Both doc surfaces already stated that
  rule; the loader read it against the map's folder instead, so the standard
  shared-tileset layout — `maps/level.json` referencing `../tilesets/terrain.tsj`
  whose image sits beside it — requested `maps/terrain.png` and every tile
  rendered blank. An embedded tileset still resolves against the map's folder.
  Both paths go through Pixi's `path.join`, so `..` segments collapse and one
  file yields one cache entry.
- `getTileAt` converts the query point through the inverse of the entity's world
  transform. It subtracted the entity's local position, while the renderer draws
  from the world transform, so a map parented under another entity or given a
  scale answered for cells that are not where it drew: a child map under a
  parent at x=100 returned `null` over drawn tiles, and a map at scale 2
  returned the second column for a point inside the first. A world scale of 0
  collapses the map and the method returns `null`.
- No map-authoring mistake stops a map from building. A tile whose tileset never
  resolved (`tsx-tileset`, `unresolved-tileset`) and a tile whose id belongs to
  no tileset are skipped, and the rest of the map draws — matching the seven
  other `error` diagnostics, which have always dropped the content they name and
  kept going. Two of them killed the whole component instead, from inside
  `TilemapComponent.onAdd`. A tileset image that is not loaded when the
  component is added still throws, naming the image and its tileset: that is a
  load-order mistake, fixed by preloading the image, not a property of the map.
- New `unknown-gid` diagnostic (severity `error`) reports the cells a layer
  fills with a tile id no tileset owns, naming the layer and, per distinct id,
  the first cell it appears in. A single-image tileset's range is bounded by its
  `tilecount`, so an id past its last tile is no longer attributed to it. A
  collection-of-images tileset keeps an open range: Tiled preserves the other
  tiles' ids when an image is deleted, so its ids can run past `tilecount`.
- `encoded-layer-data` fires on layer data that is not a flat number array. It
  also fired on the presence of an `encoding` field, so a CSV-encoded layer —
  a flat number array that renders correctly — was reported as dropped content.
- Breaking: `getPropertyArray` (and `resolveRefArray` through it) throws when
  the indices skip one, naming the missing index. It returned a sparse array
  typed as dense, so `point[0]` plus `point[2]` handed back a hole typed as a
  value.
- Docs: the collision recipe on both surfaces spawns one static entity per
  converted shape under a grouping parent. It looped `walls.add(new
ColliderComponent(cfg))` over the configs, and an entity holds one component
  per class, so any map with two or more collision objects threw during the
  scene's `onEnter`. Both surfaces also gain the `unknown-gid` code, the rule
  that no diagnostic stops a map from rendering, and the limit that a diagonal
  flip on a non-square tile draws unrotated.
