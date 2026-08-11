---
"@yagejs/tilemap": patch
---

Tiles are anchored the way Tiled draws them, and a tile object keeps the tile it draws.

- Every tile image is anchored to the bottom-left of its cell, whatever its size: one taller than the map's grid overhangs upward, a wider one to the right, and one smaller than the grid sits on the cell's bottom edge. Tiles occupied the top-left of their cell before, which drew a tall prop one or more cells too low and a small one too high. A collection-of-images tileset measures each tile's own image, so tall and short props in one tileset both land correctly — a tile smaller than the grid moves down even when the tileset's declared tile size matches the grid, because that size records only the largest image in the collection. A single-image tileset whose tile size equals the grid is unaffected.
- `MapObject.gid` (and the raw Tiled `TileObject.gid`) carries the global tile ID of an object that draws a tile, flip bits included — split them with `readTileGid`. It is absent on every other object type.
- A tile object's `x`/`y` is normalised to its top-left corner, honouring the owning tileset's `objectalignment` and the object's own rotation, so `getObjects()`, `findObject()`, `getCollisionShapes()`, `toPhysicsColliders()` and spawn code all place it where Tiled shows it. A game that compensated for the old coordinates by hand — `obj.y - obj.height` or similar — should drop that adjustment. Every other object type is untouched.
- `validateTiledMap()` reports a `tile-object` error per object layer, naming the tile objects whose images are not drawn.

Collision shapes authored on a tile inside the tileset are not read — a tile object's collider is its whole box — and a tile object's image is not drawn, so you spawn the sprite yourself from its `gid`.
