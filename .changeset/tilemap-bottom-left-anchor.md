---
"@yagejs/tilemap": patch
---

Tiles and tile objects follow Tiled's bottom-left anchoring, and a tile object reports the tile it draws.

- A tile whose image is larger than the map's grid renders anchored to the bottom-left of its cell, so a taller tile overhangs upward and a wider one to the right. It occupied the top-left of its cell before, which drew tall props one or more cells too low. A collection-of-images tileset measures each tile's own image, so tall and short props in one tileset both land correctly.
- `MapObject.gid` (and the raw Tiled `TileObject.gid`) carries the global tile ID of an object that draws a tile, flip bits included — split them with `readTileGid`. It is absent on every other object type.
- `getCollisionShapes()` places a tile object's `rect` from the bottom-left corner Tiled anchors it at, rotating the pivot about that corner when the object is turned. Rectangle, ellipse, capsule, polygon and polyline objects are unchanged.

A tileset's `objectalignment` override is not read, and collision shapes authored on a tile inside the tileset are not read either — a tile object's collider is its whole box.
