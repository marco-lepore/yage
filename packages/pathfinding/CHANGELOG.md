# @yagejs/pathfinding

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5)]:
  - @yagejs/core@0.10.0

## 0.9.0

### Minor Changes

- [#173](https://github.com/marco-lepore/yage/pull/173) [`bd3132d`](https://github.com/marco-lepore/yage/commit/bd3132d11274e3dfc29282b8ce802cfef1e73a57) Thanks [@marco-lepore](https://github.com/marco-lepore)! - New `@yagejs/pathfinding` package: grid A\* pathfinding.
  - `GridGraph` — a grid graph with A\* search. `findPath(startWorld, goalWorld)` takes world-pixel coordinates and returns a `Path` of tile-centre waypoints, or `null` when no path exists. Configurable `isWalkable`/`cost` predicates (re-read on every search, so live map changes need no rebuild), diagonal movement policy (`"never"` / `"always"` / `"no-corner-cutting"`, default `"no-corner-cutting"`), and heuristic (`"manhattan"` / `"chebyshev"` / `"octile"` / `"euclidean"`, auto-picked from the diagonal policy by default).
  - `gridFromTilemap` (import from `@yagejs/pathfinding/tilemap`) builds a `GridGraph` from a `@yagejs/tilemap` `TilemapData`'s tile layers, with `layers`/`blocked`/`cost`/`origin` options. The subpath keeps `@yagejs/tilemap` a type-only, optional peer — the root entry pulls in nothing beyond `@yagejs/core`.
  - `gridFromColliders` (same subpath) builds a `GridGraph` from Tiled object-layer collision shapes (rects, circles, capsules, polygons, polylines) instead of tile gids — a cell blocks if any shape overlaps any part of it, with exact per-shape overlap (rotated OBB, capsule core distance, concave-safe polygon fill).

  Deferred to a later minor: path smoothing, async/time-sliced search, nearest-walkable goal snapping, endpoint snapping, per-object cost, agent-radius inflation, waypoint/navmesh graphs and flow fields.

### Patch Changes

- Updated dependencies [[`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667)]:
  - @yagejs/core@0.9.0
