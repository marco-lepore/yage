# @yagejs/pathfinding

Depends on `@yagejs/core`. Grid A* pathfinding, pixels in and out.

## GridGraph

```ts
import { GridGraph } from "@yagejs/pathfinding";

const grid = new GridGraph({
  cols: 20,
  rows: 15,
  tileWidth: 32,
  tileHeight: 32,
  isWalkable: (col, row) => walls[row * cols + col] === 0, // called on every findPath, never cached
  cost: (col, row) => 1, // per-cell step multiplier, default 1, must be >= 1 for optimal paths
  diagonalMovement: "no-corner-cutting", // "never" | "always" | "no-corner-cutting" (default)
  heuristic: "octile", // "manhattan" | "chebyshev" | "octile" | "euclidean"; default: octile w/ diagonals, else manhattan
  origin: { x: 0, y: 0 }, // world px of cell (0,0)'s top-left corner
});

const path = grid.findPath({ x: 48, y: 48 }, { x: 600, y: 400 });
// Path | null: { waypoints: Vec2[], cells: GridCell[], cost: number }
```

Readonly fields: `cols`, `rows`, `tileWidth`, `tileHeight`, `origin`.
Methods: `inBounds(col, row)`, `worldToCell(v): GridCell`, `cellToWorld(col, row): Vec2` (tile centre), `findPath(startWorld, goalWorld): Path | null`.

`findPath` semantics:

- Start/goal out of grid bounds → `null`.
- Goal cell not walkable → `null`. Start cell may be blocked (an agent can straddle a blocked edge) — only the goal must be walkable.
- Same start/goal cell → one-waypoint path, `cost: 0`, regardless of that cell's walkability.
- `waypoints`/`cells` run start cell → goal cell inclusive; waypoints are tile centres (no endpoint snapping to the exact start/goal in v1).
- Deterministic: identical inputs always produce identical output.

Diagonal policy: `"never"` = 4-connected. `"always"` = 8-connected, cuts wall corners. `"no-corner-cutting"` (default) = diagonal only when both shared orthogonal cells are walkable.

## gridFromTilemap

```ts
import { gridFromTilemap } from "@yagejs/pathfinding/tilemap";

// tilemap.data is @yagejs/tilemap's TilemapData
const grid = gridFromTilemap(tilemap.data, {
  layers: ["collision"], // tile layers to read; omit = all
  blocked: (gid, col, row) => gid !== 0, // default; a cell blocks if any read layer's cell satisfies this
  cost: (gid, col, row) => 1, // maps a gid to a cell cost, default 1; highest wins across layers
  origin: tilemap.entity.get(Transform).position,
});
```

The `./tilemap` subpath keeps `@yagejs/tilemap` a type-only, optional peer — importing from the root `@yagejs/pathfinding` entry pulls in nothing beyond `@yagejs/core`.

## Not in v1

Path smoothing, async/time-sliced search, nearest-walkable goal snapping, endpoint snapping, collider-derived grids (only tile GIDs are read), waypoint/navmesh graphs, flow fields.
