---
"@yagejs/pathfinding": minor
---

New `@yagejs/pathfinding` package: grid A* pathfinding.

- `GridGraph` — a grid graph with A* search. `findPath(startWorld, goalWorld)` takes world-pixel coordinates and returns a `Path` of tile-centre waypoints, or `null` when no path exists. Configurable `isWalkable`/`cost` predicates (re-read on every search, so live map changes need no rebuild), diagonal movement policy (`"never"` / `"always"` / `"no-corner-cutting"`, default `"no-corner-cutting"`), and heuristic (`"manhattan"` / `"chebyshev"` / `"octile"` / `"euclidean"`, auto-picked from the diagonal policy by default).
- `gridFromTilemap` (import from `@yagejs/pathfinding/tilemap`) builds a `GridGraph` from a `@yagejs/tilemap` `TilemapData`'s tile layers, with `layers`/`blocked`/`cost`/`origin` options. The subpath keeps `@yagejs/tilemap` a type-only, optional peer — the root entry pulls in nothing beyond `@yagejs/core`.

Deferred to a later minor: path smoothing, async/time-sliced search, nearest-walkable goal snapping, endpoint snapping, collider-derived grids, waypoint/navmesh graphs and flow fields.
