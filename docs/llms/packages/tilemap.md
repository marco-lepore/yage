# @yage/tilemap

Depends on `@yage/core`, `@yage/renderer`. Tiled map loader and renderer.

## Setup

```ts
import { TilemapPlugin } from "@yage/tilemap";
engine.use(new TilemapPlugin());
```

## Loading Maps

```ts
import { tiledMap } from "@yage/tilemap";
import { renderAsset } from "@yage/renderer";

const MapData = tiledMap("assets/level.json");
const Tileset = renderAsset("assets/tileset.png");

class Level extends Scene {
  readonly preload = [Tileset, MapData]; // tileset must load first
}
```

## TilemapComponent

```ts
import { TilemapComponent } from "@yage/tilemap";

entity.add(new TilemapComponent({
  mapKey: MapData.path,          // serializable asset ref
  layers: ["ground", "walls"],   // tile layers to render (omit for all)
  layer: "map",                  // render layer name
}));
```

Properties:
- `widthPx` / `heightPx` — total map size in pixels
- `tileWidth` / `tileHeight` — single tile dimensions

## Tile Queries

```ts
tilemap.getTileAt(worldX, worldY, "ground"); // tile GID | null
```

## Object Layers

```ts
const objects = tilemap.getObjects("spawns");
// Record<string, MapObject[]> — grouped by class/name

// MapObject: { id, name, class?, x, y, width, height, rotation, visible, point?, polygon?, properties? }
```

## Property Utilities

```ts
import { getProperty, getPropertyArray, resolveObjectRef } from "@yage/tilemap";

getProperty<number>(obj, "speed");          // single custom property
getPropertyArray<number>(obj, "point");     // indexed: point[0], point[1]
resolveObjectRef(obj, "target", allObjs);   // resolve Tiled object reference
```

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

## Camera Bounds

```ts
camera.bounds = { minX: 0, minY: 0, maxX: tilemap.widthPx, maxY: tilemap.heightPx };
```
