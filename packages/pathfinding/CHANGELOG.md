# @yagejs/pathfinding

## 0.11.0

### Minor Changes

- [#313](https://github.com/marco-lepore/yage/pull/313) [`0cbd0bb`](https://github.com/marco-lepore/yage/commit/0cbd0bb33480531bf9b229d9fcef2b9b073490ca) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Grid inputs are validated where they enter, so a misconfigured grid throws naming the input instead of returning `null` from every search.
  - `gridFromTilemap`'s `layers` option is now required, and every name in it must match a tile layer. Omitting it read every tile layer, and a cell blocks if any read layer paints it, so an ordinary map with a filled ground layer came out fully impassable — measured on a two-layer map, 12 of 12 cells blocked and every `findPath` returning `null` with no diagnostic. Passing several names of which one was mistyped built a grid from the rest, silently dropping the mistyped layer's walls; that case now throws, naming only the unmatched names, in the same message the all-unmatched case already used.
  - A `cost` callback must return a finite number, in both `gridFromTilemap` and `GridGraph`. `NaN` (a lookup table missing a gid — `cost: (gid) => terrainCost[gid]`) and `Infinity` both make the cell unreachable without marking it blocked, because A\*'s relaxation test is false for either. The cell became an invisible wall: `findPath` returned `null` on a one-cell corridor while the grid's own `isWalkable` reported that corridor walkable. Both sites now throw naming the value, the cell, and — in the tilemap adapter — the gid.
  - `GridGraph`'s constructor checks every number it stores. `cols` and `rows` must be integers of at least 1, `tileWidth`/`tileHeight` finite and above 0, and `origin.x`/`origin.y` finite. Unchecked, each made every search fail with no explanation: `cols: 0`, `cols: NaN` and `origin: { x: NaN }` returned `null` from every `findPath`, `cols: 4.5` returned paths on row 0 and `null` on row 1, and `tileWidth: Infinity` mapped every world position to column 0 and returned a bogus one-cell path. The old positive-tile-size check threw a `RangeError` whose condition let `NaN` through and whose message did not name the value; it is now a plain `Error` in the same form as the rest.
  - Docs: the pathfinding guide no longer lists grids built from collision shapes as unsupported — `gridFromColliders` has shipped and is documented on the same page. The list gains the two entries it was missing, per-object cost and agent-radius inflation.

  **Breaking**, all pre-1.0: `gridFromTilemap` requires `layers`; add the layer names the map's walls live on. Callback returns and constructor numbers that used to build a broken grid now throw.

### Patch Changes

- Updated dependencies [[`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`a7eda5d`](https://github.com/marco-lepore/yage/commit/a7eda5d7cee1e163ea09362709d7ab35687f0fb6), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/core@0.11.0
  - @yagejs/tilemap@0.11.0

## 0.10.4

### Patch Changes

- Updated dependencies [[`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f), [`753050b`](https://github.com/marco-lepore/yage/commit/753050b08270af8a73f694e27ca886613c1b57fa)]:
  - @yagejs/core@0.10.4

## 0.10.3

### Patch Changes

- [#283](https://github.com/marco-lepore/yage/pull/283) [`6dc493e`](https://github.com/marco-lepore/yage/commit/6dc493e32c8a20e928621490c1308f99324e7208) Thanks [@marco-lepore](https://github.com/marco-lepore)! - An engine peer range names the one engine minor the package was built and tested against.
  - The optional `@yagejs/tilemap` peer range is `>=0.10.2 <0.11.0`. The tilemap adapter reads `TilemapData`, whose required fields have grown since the previous `>=0.8.0` floor, so the old window covered releases the adapter was never compiled against.
  - A game holding pathfinding and tilemap on different minors now gets a version conflict from npm at install time. The peer stays optional, so grid pathfinding without a tilemap is unaffected.

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372)]:
  - @yagejs/core@0.10.2

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
