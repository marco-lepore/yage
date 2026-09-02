# @yagejs/pathfinding

Depends on `@yagejs/core`. Grid A* pathfinding, pixels in and out.

## GridGraph

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
- `waypoints`/`cells` run start cell → goal cell inclusive; waypoints are tile centres (no endpoint snapping to the exact start/goal).
- Deterministic: identical inputs always produce identical output.

Diagonal policy: `"never"` = 4-connected. `"always"` = 8-connected, cuts wall corners. `"no-corner-cutting"` (default) = diagonal only when both shared orthogonal cells are walkable.

## gridFromTilemap

```ts
import { gridFromTilemap } from "@yagejs/pathfinding/tilemap";

// tilemap.data is @yagejs/tilemap's TilemapData
const grid = gridFromTilemap(tilemap.data, {
  layers: ["collision"], // tile layers to read; omit = all; throws if none match
  blocked: (gid, col, row) => gid !== 0, // default; a cell blocks if any read layer's cell satisfies this
  cost: (gid, col, row) => 1, // maps a gid to a cell cost, default 1, floored at 1; highest wins across layers
  origin: tilemap.entity.get(Transform).position,
});
```

Callbacks receive base tile ids — Tiled flip/rotation flag bits are masked off, so `gid === 1` matches a flipped instance of tile 1.

## gridFromColliders

```ts
import { gridFromColliders } from "@yagejs/pathfinding/tilemap";

// tilemap is a TilemapComponent; shapes are map-local px, physics-agnostic
// configs (rect/circle/capsule/polygon/polyline) — see @yagejs/tilemap.
const grid = gridFromColliders(tilemap.data, {
  shapes: tilemap.getCollisionShapes("pathfinding"), // an object layer name
  origin: tilemap.entity.get(Transform).position,
});
```

Builds a grid from Tiled object-layer shapes instead of tile gids. A cell blocks if any shape overlaps any part of it — a shape grazing a cell's edge blocks it too. Cost is 1 everywhere (no `cost` option). `shapes` is typically `TilemapComponent.getCollisionShapes(layerName?)`.

Shape overlap is exact per cell, not bounding-box: a rotated rect uses its true OBB, a capsule its rounded core, and a polygon its true (possibly concave) outline — cells inside a concave notch stay walkable. A closed polyline (first vertex repeated at the end, matching what a Tiled Polygon-tool object extracts) is a filled, possibly concave region. An open polyline chain blocks only the cells its segments cross (a thin wall).

## From physics colliders

No adapter reads `@yagejs/physics` collider shapes directly. Build `isWalkable` yourself with `PhysicsWorld.queryShape`, one query per cell, at level-build time:

```ts
import { GridGraph } from "@yagejs/pathfinding";
import { PhysicsWorldKey } from "@yagejs/physics";

const cols = 40, rows = 30, cell = 32;
const world = this.use(PhysicsWorldKey);
const blocked = new Set<number>();

const grid = new GridGraph({
  cols, rows, tileWidth: cell, tileHeight: cell,
  isWalkable: (col, row) => !blocked.has(row * cols + col),
});

for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const centre = grid.cellToWorld(col, row);
    if (world.queryShape({ type: "box", width: cell, height: cell }, centre).length > 0) {
      blocked.add(row * cols + col);
    }
  }
}
```

Run the loop right after spawning the level's colliders — the query sees them
without waiting for a physics step. Trigger zones (`sensor: true`) do not block:
pass `sensors: "include"` to `queryShape` if they should.

40×30 = 1200 queries; run once at level build, not per frame. `blocked` is a snapshot — colliders that move or spawn later don't update it. After a layout change, call `blocked.clear()` and re-run the loop; the loop only adds cells, so without the clear a removed wall stays blocked.

## Not supported

Path smoothing, async/time-sliced search, nearest-walkable goal snapping, endpoint snapping, per-object cost, agent-radius inflation, waypoint/navmesh graphs, flow fields.
