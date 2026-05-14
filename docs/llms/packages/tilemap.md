# @yagejs/tilemap

Depends on `@yagejs/core`, `@yagejs/renderer`. Tiled map loader and renderer.

## Capabilities & Limits

Supported: orthogonal Tiled JSON (tilesets must be exported as JSON, not TSX), multiple tile layers, object layers + custom properties, object-reference resolution, collision-shape extraction (raw `rect` / `polygon` / `polyline` / `circle` (Tiled ellipse) / `capsule` shapes), `toPhysicsColliders()` adapter to Rapier collider configs, tileset-image and collection-of-images tilesets.

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

Not supported: animated tiles, infinite/chunked maps, isometric/hex/staggered orientations, dynamic tile editing at runtime, built-in parallax layers (use a regular render layer with a scrolling sprite).

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

## Serialization

`TilemapComponent` is `@serializable`, but the live parsed `TiledMapData` object is not — it contains PixiJS textures. Pass `source` (an asset handle) or `mapKey` (an asset path) instead of `map` if you want save/load to restore the tilemap after a reload:

```ts
interface TilemapComponentOptions {
  source?: AssetHandle<TiledMapData>;  // preferred — handle from tiledMap()
  map?: TiledMapData;                  // raw parsed data — not serializable
  mapKey?: string;                     // asset path — serializable, resolved via Assets.get
  layers?: string[];                   // which tile layers to render (omit for all)
  layer?: string;                      // render layer name (default "default")
  keyPrefix?: string;                  // override for auto-keys (default = mapKey)
}

// Serialized shape stored in snapshots:
interface TilemapComponentData {
  mapKey: string;               // required — saved snapshots always reference an asset
  layers?: string[];
  layer: string;
  keyPrefix?: string;           // only present when overridden
}
```

At least one of `source`, `map`, or `mapKey` must be supplied. If you construct with an inline `map`, snapshot serialization will warn and require `source` or `mapKey` to round-trip.

## Tile Queries

```ts
tilemap.getTileAt(worldX, worldY, "ground"); // tile GID | null
```

## Map Data

The `tilemap.data` property exposes the parsed map in a format-agnostic shape (separate from Tiled-specific JSON). Useful for gameplay code that needs raw tile layers or object layers without reaching into Pixi containers:

```ts
interface TilemapData {
  width: number;           // tiles wide
  height: number;          // tiles tall
  tileWidth: number;       // pixel width of one tile
  tileHeight: number;
  tileLayers: TileLayerData[];
  objectLayers: ObjectLayerData[];
}

interface TileLayerData {
  name: string;
  data: number[];          // flat row-major tile GIDs (0 = empty)
  width: number;
  height: number;
  visible: boolean;
}

interface ObjectLayerData {
  name: string;
  objects: MapObject[];
  visible: boolean;
}
```

`MapObject` carries `id`, `name`, optional `class`, `x`/`y`/`width`/`height`/`rotation`, optional `point` / `ellipse` / `capsule` flags, an optional `polygon`, and an optional `properties: MapObjectProperty[]` array of Tiled custom properties.

## Object Layers

```ts
// Grouped by class ?? name (per object layer)
const objects = tilemap.getObjects("spawns");
// Record<string, MapObject[]>

// No-arg variant — every object across every layer, grouped by class ?? name
const grouped = tilemap.getObjects();
// Record<string, MapObject[]>

// Flat list across every object layer
const all = tilemap.getAllObjects();

// Direct lookups
tilemap.findObject(42);            // by Tiled id
tilemap.findObjectByName("Player"); // first match across all layers

// MapObject: { id, name, class?, x, y, width, height, rotation, visible, point?, polygon?, properties? }
```

## Spawning Entities from Tiled Objects (auto-keys)

Tiled object IDs are stable per-map identifiers. Combine them with the map's asset path to derive a stable per-scene `entity.key` that persistent stores can use:

```ts
import { tiledObjectKey, TilemapComponent } from "@yagejs/tilemap";

// Format: `<mapKey>#object:<id>` (or `<keyPrefix>#object:<id>` if you set one)
tiledObjectKey("/assets/dungeon.json", 42);
// → "/assets/dungeon.json#object:42"

// On the component:
tilemap.objectKey(obj);            // prefix already wired up
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

The component-method variants of `resolveRef` / `resolveRefArray` walk every object layer for you; reach for the standalone helpers only when you've already collected the pool yourself.

## Collision Extraction

```ts
const shapes = tilemap.getCollisionShapes("walls");
// TilemapColliderConfig[]:
//   { type: "rect",     x, y, width, height }
//   { type: "circle",   x, y, width, height, radius }                 // Tiled ellipse
//   { type: "capsule",  x, y, width, height, halfHeight, radius, axis }
//   { type: "polygon",  x, y, vertices }                              // closed convex
//   { type: "polyline", x, y, vertices }                              // chain; may be non-convex (emitted from Tiled polygons)
```

Mapping from Tiled object → emitted shape:
- Rectangle → `rect`.
- Ellipse (w === h) → `circle`.
- Ellipse (w !== h) → `circle` with `radius = max(w, h) / 2` and a dev-warning (Rapier has no real ellipse primitive — author it as a capsule for a true non-circular round shape).
- Capsule → `capsule` with `halfHeight = (max(w,h) - min(w,h)) / 2`, `radius = min(w,h) / 2`, `axis = "y"` if taller than wide else `"x"`.
- Polygon → `polyline` (Tiled polygons are outlines, not solid hulls).
- Point → skipped.

Standalone functions: `extractCollisionShapes()`, `toPhysicsColliders()`.

## Physics Integration

`toPhysicsColliders(shapes)` converts the tilemap collision shapes (top-left origin, as stored in Tiled) into `@yagejs/physics` `ColliderConfig` shape-plus-offset pairs (center origin, as Rapier expects). Use it when wiring extracted walls to a static physics body:

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

`toPhysicsColliders` handles every emitted shape: rects → `box`, circles → `circle`, capsules → `capsule` (with `axis` preserved — `"x"` rotates the capsule 90°), polygons → `polygon`, polylines → `polyline`. The offset is baked in so the Rapier collider sits at the Tiled object's bounding-box center.

Polylines are static-only (no inertia is computed). Attach them to a `RigidBodyComponent({ type: "static" })`.

## Camera Bounds

```ts
camera.bounds = { minX: 0, minY: 0, maxX: tilemap.widthPx, maxY: tilemap.heightPx };
```
