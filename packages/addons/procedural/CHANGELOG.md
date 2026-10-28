# @yagejs-addons/procedural

## 0.1.0

### Minor Changes

- [#414](https://github.com/marco-lepore/yage/pull/414) [`ab01a9d`](https://github.com/marco-lepore/yage/commit/ab01a9d810a62ecbd4e46e846f298e7375ea17d1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add seeded procedural map generation: region graphs from requirements, catalog room layouts, catalog selection without placement, and cellular caves.
  - Generate region graphs with named regions, counts per kind, forbidden neighbours, a degree limit and permanent keys. Validate any graph's progression, including keys the player holds at the start.
  - Place room templates for every region with doors that match by side, width and socket. Doors can take a fixed position or any position in a range. Rooms without a navigation mask are walls around an open floor.
  - Choose templates and weighted variants under count, per-region and connection rules, with or without placing rooms. A count rule no selection can meet, or a connection whose every template pair a forbidden-connection rule rejects, throws when the generator is created. Catalog generation checks a graph's structure, including a connection path from the start to every region; progression is checked with `validateRegionGraph`. Results carry each region's kind, keys, variant, metadata and tags.
  - Return layouts as plain JSON that need no catalog to draw, navigate or load. Check saved layouts and selections against the current catalog.
  - Run generation across frames with a component that pauses, cancels and reports to the Inspector. Diagnostics name the count or connection rule that rejected a candidate.
  - Restart region graph, catalog and room searches in a new random order when one attempt runs long, so a single early choice cannot use up the budget. A finished attempt has tried every choice, so `exhausted` means the inputs have no result.
  - Navigate layouts with a pathfinding graph that reads the game's keys during every path search, or navigate any tile map. Load authored level content into each room, chosen per room by a `levelFor` callback. Every room's content and scene keys are checked before the first room loads. The `/level` entry needs `@yagejs/level` 0.13.0 or later.

### Patch Changes

- Updated dependencies [[`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`60028a9`](https://github.com/marco-lepore/yage/commit/60028a912a115020b6deffd0f25b6c82315175f5), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/core@0.13.0
  - @yagejs/level@0.13.0
  - @yagejs/pathfinding@0.13.0
