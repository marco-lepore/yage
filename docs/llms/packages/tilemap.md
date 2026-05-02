# @yagejs/tilemap

Depends on `@yagejs/core`, `@yagejs/renderer`. Tiled map loader and renderer.

## Capabilities & Limits

Supported: orthogonal Tiled JSON, multiple tile layers, object layers + custom properties, object-reference resolution, collision-shape extraction (raw `rect` / `polygon` shapes), `toPhysicsColliders()` adapter to Rapier collider configs, tileset-image and collection-of-images tilesets.

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

entity.add(new TilemapComponent({
  mapKey: MapData.path,          // serializable asset ref
  layers: ["ground", "walls"],   // tile layers to render (omit for all)
  layer: "map",                  // render layer name
}));
```

Properties:
- `widthPx` / `heightPx` — total map size in pixels
- `tileWidth` / `tileHeight` — single tile dimensions
- `data: TilemapData` — parsed map structure (see Map Data below)

## Serialization

`TilemapComponent` is `@serializable`, but the live parsed `TiledMapData` object is not — it contains PixiJS textures. Pass `mapKey` (an asset path) instead of `map` if you want save/load to restore the tilemap after a reload:

```ts
interface TilemapComponentOptions {
  map?: TiledMapData;          // live parsed map — not serializable
  mapKey?: string;              // asset path — serializable, resolved via Assets.get
  layers?: string[];            // which tile layers to render (omit for all)
  layer?: string;               // render layer name (default "default")
}

// Serialized shape stored in snapshots:
interface TilemapComponentData {
  mapKey: string;               // required — saved snapshots always reference an asset
  layers?: string[];
  layer: string;
}
```

At least one of `map` or `mapKey` must be supplied. If you construct with an inline `map`, snapshot serialization will warn and require a `mapKey` to round-trip.

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

`MapObject` carries `id`, `name`, optional `class`, `x`/`y`/`width`/`height`/`rotation`, an optional `point` flag, an optional `polygon`, and an optional `properties: MapObjectProperty[]` array of Tiled custom properties.

## Object Layers

```ts
const objects = tilemap.getObjects("spawns");
// Record<string, MapObject[]> — grouped by class/name

// MapObject: { id, name, class?, x, y, width, height, rotation, visible, point?, polygon?, properties? }
```

## Property Utilities

```ts
import { getProperty, getPropertyArray, resolveObjectRef } from "@yagejs/tilemap";

getProperty<number>(obj, "speed");          // single custom property
getPropertyArray<number>(obj, "point");     // indexed: point[0], point[1]
resolveObjectRef(obj, "target", allObjs);   // resolve Tiled object reference
```

## Object Reference Resolution

Tiled's object-reference properties store numeric IDs, not the target objects themselves. `resolveObjectRef` and `resolveObjectRefArray` turn those IDs into `MapObject` instances by searching a caller-supplied array:

```ts
import { resolveObjectRef, resolveObjectRefArray } from "@yagejs/tilemap";

const allObjects = Object.values(tilemap.getObjects("interactables")).flat();

// Single ref: door has a `target` property of type `object`
for (const door of tilemap.getObjects("doors").door ?? []) {
  const exit = resolveObjectRef(door, "target", allObjects);
  if (exit) spawnDoor(door, exit);
}

// Array ref: trigger has `targets[0]`, `targets[1]`, ... properties
for (const trigger of tilemap.getObjects("triggers").trigger ?? []) {
  const targets = resolveObjectRefArray(trigger, "targets", allObjects);
  spawnTrigger(trigger, targets);
}
```

IDs that can't be resolved (e.g. the referenced object was deleted) are silently filtered out.

## Collision Extraction

```ts
const shapes = tilemap.getCollisionShapes("walls");
// TilemapColliderConfig[] — { type: "rect", x, y, width, height } | { type: "polygon", x, y, vertices }

// Convert to physics:
for (const s of shapes) {
  if (s.type === "rect") {
    wall.add(new ColliderComponent({
      shape: { type: "box", width: s.width, height: s.height },
    }));
  }
}
```

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

`toPhysicsColliders` handles both `rect` and `polygon` shapes — rects become `box` shapes with the offset baked in; polygons stay as `polygon` shapes with an offset matching the Tiled origin.

## Camera Bounds

```ts
camera.bounds = { minX: 0, minY: 0, maxX: tilemap.widthPx, maxY: tilemap.heightPx };
```
