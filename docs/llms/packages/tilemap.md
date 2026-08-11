# @yagejs/tilemap

Depends on `@yagejs/core`, `@yagejs/renderer`. Tiled map loader and renderer.

## Capabilities & Limits

Supported: orthogonal Tiled JSON (tilesets must be exported as JSON, not TSX), multiple tile layers, object layers, custom properties on the map / layers / tilesets / objects, object-reference resolution, collision-shape extraction from rectangle / ellipse / polygon / polyline / tile objects (raw `rect` / `circle` / `polygon` / `polyline` / `capsule` shapes), `toPhysicsColliders()` adapter to Rapier collider configs, tileset-image and collection-of-images tilesets, embedded and external tilesets, flipped and rotated tiles, tile images that do not match the map grid (anchored bottom-left), animated tiles (see below), layer `offsetx`/`offsety` and tileset `tileoffset`, per-layer `visible` and `opacity`.

Tilesets MUST be exported as JSON (`.tsj` / `.json`). Tiled's default XML `.tsx` format is not supported — in Tiled, *Edit Tileset → File → Export As → JSON*.

### Staging Tiled assets

The loader resolves a single-image tileset's `image` field **relative to the tileset JSON file** (`basePath + tileset.image`, where `basePath = path.dirname(tilesetSrc)`). Tiled writes that field as the relative path *from where the tileset was authored*, which is usually somewhere on your filesystem outside the project (e.g. `../../Downloads/spr_tileset.png`). Copying the tileset JSON into `public/` without rewriting `image` produces a silent 404 in the browser — the tileset loads, the texture doesn't, tiles render as blanks.

When you stage a Tiled tileset into `public/assets/maps/`, rewrite `image` to a sibling-relative path:

```diff
 // public/assets/maps/dungeon.tsj
 {
   "tilewidth": 16,
   "tileheight": 16,
   "tilecount": 256,
-  "image": "../../Downloads/tiled-projects/dungeon/spr_tileset.png",
+  "image": "spr_tileset.png",
   ...
 }
```

…and put `spr_tileset.png` next to the JSON. Same rule for embedded tilesets inside a map JSON — the `image` field is resolved relative to the *map* file's directory.

Not supported: infinite/chunked maps, base64-encoded layer data, isometric/hex/staggered orientations, group layers and image layers, dynamic tile editing at runtime, built-in parallax layers (use a regular render layer with a scrolling sprite), drawing a tile object's image (its `gid` and box are parsed — you spawn the sprite), a tileset's `objectalignment` override, collision shapes authored on a tile inside the tileset.

`validateTiledMap()` reports every one of these in a map — see [Unsupported Forms](#unsupported-forms).

Workflow: parse Tiled JSON → `tilemap.getCollisionShapes("walls")` returns raw top-left-origin shapes → `toPhysicsColliders(shapes)` converts to center-origin Rapier configs → spawn a static body with one `ColliderComponent` per config.

## Setup

```ts
import { TilemapPlugin } from "@yagejs/tilemap";
engine.use(new TilemapPlugin());
```

## Loading Maps

```ts
import { tiledMap } from "@yagejs/tilemap";
import { renderAsset } from "@yagejs/renderer";

const MapData = tiledMap("assets/level.json");
const Tileset = renderAsset("assets/tileset.png");

class Level extends Scene {
  readonly preload = [Tileset, MapData]; // tileset must load first
}
```

## TilemapComponent

```ts
import { TilemapComponent } from "@yagejs/tilemap";

// Preferred: pass the asset handle. Captures both the parsed data and the
// asset path, which doubles as the prefix for Tiled-derived auto-keys.
entity.add(new TilemapComponent({
  source: MapData,               // AssetHandle<TiledMapData>
  layers: ["ground", "walls"],   // tile layers to render (omit for all)
  layer: "map",                  // render layer name
}));
```

Properties:
- `widthPx` / `heightPx` — total map size in pixels
- `tileWidth` / `tileHeight` — single tile dimensions
- `data: TilemapData` — parsed map structure (see Map Data below)
- `mapKey: string | null` — asset path, or `null` if constructed from raw `map:` data
- `keyPrefix: string | null` — prefix used for `objectKey` / `forEachObject`
- `container: DisplayContainer` — the Pixi container holding the rendered layers

`TilemapComponent` extends the renderer's `VisualComponent`, so it takes the same visual options as `SpriteComponent` and carries the same vocabulary:

```ts
const tilemap = new TilemapComponent({
  source: MapData,
  layer: "map",
  tint: 0x6688cc,   // whole-map colour multiply
  alpha: 0.8,
});

tilemap.tint = 0xffffff;              // clear the tint
tilemap.blendMode = "add";
tilemap.visible = false;
tilemap.fx.addEffect(bloom({ strength: 2 }));   // component-scope effects
tilemap.setMask(spriteMask(maskSprite));
```

`tint` and `alpha` are applied by a colour filter on the container, because the tile shader has no colour uniform. They cost nothing while tint is white and alpha is 1.

## Serialization

`TilemapComponent` is `@serializable`, but the live parsed `TiledMapData` object is not — it contains PixiJS textures. Pass `source` (an asset handle) or `mapKey` (an asset path) instead of `map` if you want save/load to restore the tilemap after a reload:

```ts
interface TilemapComponentOptions extends VisualComponentOptions {
  source?: AssetHandle<TiledMapData>;  // preferred — handle from tiledMap()
  map?: TiledMapData;                  // raw parsed data — not serializable
  mapKey?: string;                     // asset path — serializable, resolved via Assets.get
  layers?: string[];                   // which tile layers to render (omit for all)
  keyPrefix?: string;                  // override for auto-keys (default = mapKey)
  // from VisualComponentOptions: layer, visible, tint, alpha, blendMode, interactive
}

// Serialized shape stored in snapshots:
interface TilemapComponentData extends VisualComponentData {
  mapKey: string;               // required — saved snapshots always reference an asset
  layers?: string[];
  keyPrefix?: string;           // only present when overridden
  // from VisualComponentData: layer, tint, alpha, visible, blendMode, effects, mask
}
```

At least one of `source`, `map`, or `mapKey` must be supplied. If you construct with an inline `map`, snapshot serialization will warn and require `source` or `mapKey` to round-trip.

## Tile Queries

```ts
tilemap.getTileAt(worldX, worldY, "ground"); // tile id | null
```

Each layer is read through its own draw offset, and Tiled's flip bits are stripped, so the id compares against a tileset's numbering whichever way the tile faces.

A tileset's `tileoffset` is not reversed: it moves where a tile's image is drawn, not which cell the tile occupies, and one layer can mix tilesets that offset differently. A tile from an offset tileset answers at its cell.

Every tile image is anchored to the bottom-left of its cell, the way Tiled draws it, whatever its size: one taller than the grid overhangs upward and a wider one to the right, and one smaller than the grid sits on the cell's bottom edge. The tile still occupies the one cell, so `getTileAt` answers there and not under the overhang. In a collection-of-images tileset each tile is measured on its own, so tall and short props can share a tileset.

Raw layer data (`tilemap.data.tileLayers[i].data`) keeps Tiled's GIDs with those bits intact. Split one with `readTileGid`:

```ts
import { readTileGid, tileIdFromGid } from "@yagejs/tilemap";

const gid = layer.data[row * layer.width + col]!;
readTileGid(gid);
// { id, flippedHorizontally, flippedVertically, flippedDiagonally }
tileIdFromGid(gid); // just the id
```

A flipped or rotated tile renders the way Tiled shows it. The diagonal flip is a reflection across the tile's main diagonal, and combined with the horizontal and vertical flips it covers all eight orientations of a square.

## Animated Tiles

An animation authored in Tiled plays with no setup — no component option, no per-frame game code. The clock comes from the scene, so a paused scene freezes its tilemaps and `timeScale` slows them.

An animation plays when all of the following hold. Tiled's animation editor produces this shape by default:

- The tileset is a single image, not a collection of separate images.
- Every frame has the same duration.
- The frames sit a constant pixel distance apart in the tileset image — consecutive along a row, or down a column. Any constant step works, including a diagonal one.

Anything else renders unanimated, as the tile the map places, and reports an `unsupported-tile-animation` warning naming the tile and the reason: differing durations, an irregular frame layout, or a collection-of-images tileset.

The animation phase is not saved. A tilemap restored from a snapshot starts its cycle from zero.

## Map Data

The `tilemap.data` property exposes the parsed map in a format-agnostic shape (separate from Tiled-specific JSON). Useful for gameplay code that needs raw tile layers or object layers without accessing Pixi containers directly:

```ts
interface TilemapData {
  width: number;           // tiles wide
  height: number;          // tiles tall
  tileWidth: number;       // pixel width of one tile
  tileHeight: number;
  properties?: MapObjectProperty[];   // the map's own custom properties
  tileLayers: TileLayerData[];
  objectLayers: ObjectLayerData[];
  tilesets: TilesetInfo[];
  diagnostics: TilemapDiagnostic[];   // see Unsupported Forms
}

interface TileLayerData {
  name: string;
  data: number[];          // flat row-major tile GIDs (0 = empty)
  width: number;
  height: number;
  visible: boolean;
  offsetX: number;         // Tiled layer draw offset, in pixels
  offsetY: number;
  properties?: MapObjectProperty[];
}

interface ObjectLayerData {
  name: string;
  objects: MapObject[];    // coordinates already include offsetX/offsetY
  visible: boolean;
  offsetX: number;
  offsetY: number;
  properties?: MapObjectProperty[];
}

interface TilesetInfo {
  firstGid: number;
  name?: string;           // present once the tileset data is resolved
  properties?: MapObjectProperty[];
}
```

`MapObject` carries `id`, `name`, optional `class`, `x`/`y`/`width`/`height`/`rotation`, an optional `gid` (see [Tile Objects](#tile-objects)), optional `point` / `ellipse` / `capsule` flags, an optional `polygon`, an optional `polyline`, and an optional `properties: MapObjectProperty[]` array of Tiled custom properties.

## Unsupported Forms

`validateTiledMap(map)` takes raw Tiled JSON and returns what this package cannot render. The same list is on `tilemap.data.diagnostics`, and `TilemapComponent` logs it as one `console.warn` when a map has any.

```ts
import { validateTiledMap } from "@yagejs/tilemap";

for (const d of validateTiledMap(rawTiledJson)) {
  console.log(d.severity, d.code, d.message, d.layer, d.tileset);
}
```

```ts
interface TilemapDiagnostic {
  code: TilemapDiagnosticCode;
  message: string;
  severity: "error" | "warning";  // error: content is dropped or renders wrong
  layer?: string;                 // set when the diagnostic is about a layer
  tileset?: string;
}
```

Codes: `unsupported-orientation`, `infinite-map`, `chunked-layer`, `encoded-layer-data`, `group-layer`, `image-layer`, `tsx-tileset`, `unresolved-tileset` (errors); `layer-parallax`, `tileset-object-alignment`, `unsupported-tile-animation` (warnings).

A group layer and everything nested inside it is dropped — the diagnostic names the children so you can see what is missing. An external tileset that has not loaded yet is not a diagnostic; it resolves during preload.

## Object Layers

```ts
// Grouped by class ?? name (per object layer)
const objects = tilemap.getObjects("spawns");
// Record<string, MapObject[]>

// No-arg variant — every object across every layer, grouped by class ?? name
const grouped = tilemap.getObjects();
// Record<string, MapObject[]>

// Layer-aware: one entry per (layer, class), so two layers holding the same
// class stay separate and a classless object is never keyed by its name
const groups = tilemap.getObjectGroups();
// MapObjectGroup[]: { layer: string; class?: string; objects: MapObject[] }

// Flat list across every object layer
const all = tilemap.getAllObjects();

// Direct lookups
tilemap.findObject(42);            // by Tiled id
tilemap.findObjectByName("Player"); // first match across all layers

// MapObject: { id, name, class?, x, y, width, height, rotation, visible, gid?, point?, polygon?, polyline?, properties? }
```

## Tile Objects

An object that draws a tile carries `gid`, the global tile ID of the tile it shows. The image itself is not drawn — object layers are data, so you spawn the sprite. Tiled anchors that object at its **bottom-left** corner, so its `y` is the bottom edge — every other object type measures `y` from its top.

```ts
import { readTileGid } from "@yagejs/tilemap";

for (const obj of tilemap.getAllObjects()) {
  if (obj.gid === undefined) continue;              // not a tile object
  const { id, flippedHorizontally } = readTileGid(obj.gid);
  const topLeftY = obj.y - obj.height;              // where the image starts
  scene.spawn(PropEntity, { tileId: id, x: obj.x, y: topLeftY, flippedHorizontally });
}
```

That subtraction is the unrotated case. Tiled turns a tile object about the same bottom-left corner, so for `obj.rotation !== 0` the drawn box swings away from `obj.x, obj.y - obj.height`. Reproduce it without trigonometry by giving the sprite a bottom-left anchor and placing it on the corner itself: `anchor: { x: 0, y: 1 }`, position `obj.x, obj.y`, rotation `obj.rotation` in radians.

`getCollisionShapes()` accounts for the anchor already: a tile object emits a `rect` covering the tile's drawn box, measured up from the bottom-left corner (and swung about that corner when the object is rotated).

Two limits. Collision shapes authored on the tile itself, inside the tileset, are not read — the emitted rect is the tile's whole box. And a tileset's `objectalignment` is not read either, so a map that overrides it still has its tile objects placed bottom-left; `validateTiledMap` reports that as a `tileset-object-alignment` warning.

## Spawning Entities from Tiled Objects (auto-keys)

Tiled object IDs are stable per-map identifiers. Combine them with the map's asset path to derive a stable per-scene `entity.key` that persistent stores can use:

```ts
import { tiledObjectKey, TilemapComponent } from "@yagejs/tilemap";

// Format: `<mapKey>#object:<id>` (or `<keyPrefix>#object:<id>` if you set one)
tiledObjectKey("/assets/dungeon.json", 42);
// → "/assets/dungeon.json#object:42"

// On the component:
tilemap.objectKey(obj);            // prefix already applied
tilemap.forEachObject("interactables", (obj, key) => {
  if (obj.class === "EnemySpawn") {
    scene.spawn(EnemyEntity, { object: obj }, { key });
  }
});
```

Pass `keyPrefix: "level1"` to the component constructor when multiple instances of the same map need distinct identity namespaces (instanced dungeons, per-floor layouts).

`objectKey` and `forEachObject` throw if the component was constructed from raw `map:` data without a `mapKey`, `source`, or explicit `keyPrefix` — auto-keys need a stable prefix.

## Property Utilities

```ts
// On the component (preferred — typed and discoverable):
tilemap.getProperty<number>(obj, "speed");
tilemap.getPropertyArray<number>(obj, "point");   // point[0], point[1], ...
tilemap.resolveRef(obj, "target");                // auto-collects across layers
tilemap.resolveRefArray(ctrl, "spawns");          // spawns[0], spawns[1], ...

// Standalone equivalents (caller supplies the object pool):
import {
  getProperty,
  getPropertyArray,
  resolveObjectRef,
  resolveObjectRefArray,
} from "@yagejs/tilemap";
getProperty<number>(obj, "speed");
getPropertyArray<number>(obj, "point");
resolveObjectRef(obj, "target", allObjs);             // single object ref
resolveObjectRefArray(obj, "spawns", allObjs);        // spawns[0], spawns[1], ...
```

The component-method variants of `resolveRef` / `resolveRefArray` walk every object layer for you; use the standalone helpers only when you've already collected the pool yourself.

All four take anything carrying a `properties` array, so the map, a layer and a tileset read the same way as an object:

```ts
tilemap.getProperty<string>(tilemap.data, "biome");
tilemap.getProperty<number>(tilemap.data.tileLayers[0], "damage");
tilemap.getProperty<string>(tilemap.data.tilesets[0], "material");
```

## Collision Extraction

```ts
const shapes = tilemap.getCollisionShapes("walls");
// TilemapColliderConfig[]:
//   { type: "rect",     x, y, width, height, rotation? }              // rotation: radians about (x, y)
//   { type: "circle",   x, y, width, height, radius }                 // Tiled ellipse
//   { type: "capsule",  x, y, width, height, halfHeight, radius, axis, rotation? }
//   { type: "polygon",  x, y, vertices }                              // closed convex
//   { type: "polyline", x, y, vertices }                              // chain; may be non-convex (emitted from Tiled polygons)
```

Mapping from Tiled object → emitted shape:
- Rectangle → `rect`.
- Tile object (has a `gid`) → `rect` over the tile's drawn box, measured up from the bottom-left corner Tiled anchors it at.
- Ellipse (w === h) → `circle`.
- Ellipse (w !== h) → `polygon` sampling the ellipse outline (24 vertices; Rapier has no ellipse primitive, and the sampled ring is convex so the physics-side convex hull matches it exactly).
- Capsule → `capsule` with `halfHeight = (max(w,h) - min(w,h)) / 2`, `radius = min(w,h) / 2`, `axis = "y"` if taller than wide else `"x"`.
- Polygon → `polyline` with the first vertex appended at the end (Tiled polygons are closed outlines; the appended vertex gives the chain its closing edge).
- Polyline → `polyline` verbatim (open chain).
- Point → skipped.
- Object rotation (degrees in Tiled, pivoting on the object's position) is honored for every shape: polygon/polyline/sampled-ellipse vertices are rotated at extraction, a rotated circle gets its position shifted, and rect/capsule configs carry `rotation` in radians.

Standalone functions: `extractCollisionShapes()`, `toPhysicsColliders()`.

## Physics Integration

`toPhysicsColliders(shapes)` converts the tilemap collision shapes (top-left origin, as stored in Tiled) into `@yagejs/physics` `ColliderConfig` shape-plus-offset pairs (center origin, as Rapier expects). Use it when attaching extracted walls to a static physics body:

```ts
import { toPhysicsColliders } from "@yagejs/tilemap";
import { RigidBodyComponent, ColliderComponent } from "@yagejs/physics";

const walls = scene.spawn("walls");
walls.add(new Transform());
walls.add(new RigidBodyComponent({ type: "static" }));

const configs = toPhysicsColliders(tilemap.getCollisionShapes("walls"));
for (const cfg of configs) {
  walls.add(new ColliderComponent(cfg));
}
```

`toPhysicsColliders` handles every emitted shape: rects → `box`, circles → `circle`, capsules → `capsule` (with `axis` preserved — `"x"` rotates the capsule 90°), polygons → `polygon`, polylines → `polyline`. Box, circle, and capsule colliders take the Tiled object's bounding-box center as their offset; polygon and polyline colliders keep the object's top-left position, with vertices relative to it. Rect and capsule `rotation` is forwarded to the physics config, with the center offset rotated about the Tiled pivot.

Polylines are static-only (no inertia is computed). Attach them to a `RigidBodyComponent({ type: "static" })`.

## Camera Bounds

```ts
camera.bounds = { minX: 0, minY: 0, maxX: tilemap.widthPx, maxY: tilemap.heightPx };
```
