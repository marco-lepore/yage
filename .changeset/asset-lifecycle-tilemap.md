---
"@yagejs/tilemap": minor
---

A map owns its tileset images: loading the map loads them, unloading it frees them, and two maps no longer share tiles by accident.

- The `tiledMap` handle loads every single-image tileset the map references, as
  ordinary counted `texture()` handles, and `assets.unload(mapHandle)` releases
  them. The images were loaded outside the asset manager's reference counts and
  the map's `unload` was empty, so a level-selection loop grew the texture cache
  without bound. Counting them means a second map on the same tileset, or a
  sprite drawing from the same sheet, keeps the image alive until it too
  releases it. Drop the separate `renderAsset(tilesetPath)` handle from your
  scene's `preload` — declaring one file twice is what makes one unload destroy
  it for the other.
- Two maps whose tilesets share an image _file name_ no longer draw each other's
  tiles. Tile frames were written into the global Pixi cache under the image
  name as written in the map file, so `forest/terrain.png` and
  `cave/terrain.png` collided and the second map reused the first map's art. The
  same cache also handed back frames whose image had already been unloaded.
  Frames are now cut per component from the loaded image and destroyed with the
  component.
- Breaking: `createTilemapLayers` returns `{ layers, textures }` rather than an
  array of layers. `textures` holds the frames the call cut; a caller building
  layers directly owns them and calls `destroy(false)` on each when the layers
  go. `TilemapComponent` does this for the layers it builds.
- Unloading a map also drops the external tileset (`.tsj`) files it inlined,
  which nothing released before. A tileset file is plain data — a map that
  inlined it holds its own copy — so a second map sharing it keeps drawing and
  re-fetches the file only if it is loaded again.
- `TilesetData` gains `resolvedImage`, the image path joined against the folder
  of the file that names it, which is the key the image loads under.
  `TilesetRef` gains `resolvedSource`, the same for an external tileset's JSON.
- Docs: both surfaces show a map's preload as the map handle alone, state that
  unloading it releases its images, and carry the rule that one file gets one
  declaration form.
