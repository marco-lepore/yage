# @yagejs/pathfinding

Grid A* pathfinding for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/pathfinding
```

## Usage

```ts
import { GridGraph } from "@yagejs/pathfinding";

const cols = 20;
const rows = 15;
const walls = new Uint8Array(cols * rows); // 1 = blocked
const grid = new GridGraph({
  cols,
  rows,
  tileWidth: 32,
  tileHeight: 32,
  isWalkable: (col, row) => walls[row * cols + col] === 0,
});

const path = grid.findPath({ x: 48, y: 48 }, { x: 600, y: 400 });
```

A tilemap adapter is available behind a subpath so a grid-only consumer never
pulls in `@yagejs/tilemap`:

```ts
import { gridFromTilemap } from "@yagejs/pathfinding/tilemap";

const grid = gridFromTilemap(tilemap.data, { layers: ["collision"] });
```

The same subpath also builds a grid from Tiled object-layer shapes (rects,
circles, capsules, polygons, polylines) instead of tile gids:

```ts
import { gridFromColliders } from "@yagejs/pathfinding/tilemap";

const grid = gridFromColliders(tilemap.data, {
  shapes: tilemap.getCollisionShapes("pathfinding"),
});
```

See the [Pathfinding guide](https://yage.dev/guides/pathfinding) for the full
option reference.
