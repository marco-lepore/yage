---
"@yagejs/tilemap": patch
---

Guard the Tiled tileset subtexture cache against duplicate keys, and key cache entries on the tileset image path.

- `tiledMapLoaderParser` called `Assets.cache.set(cacheKey, subtex)` unconditionally for every tile on every load — re-loading the same map (or two maps that share a tileset) triggered Pixi's `[Cache] already has key` warning and re-allocated subtextures the cache already held. The loader now skips both the `Texture` construction and the `cache.set` when the key already exists.
- The subtexture cache key now derives from the tileset's image path rather than its user-supplied display name, so two tilesets that happen to share a name can't silently return one another's subtextures. The loader and `parseTiledMap` share a `subtextureCacheKey()` helper to stay in lock-step.
- Documented the JSON-tileset requirement: tilesets must be exported from Tiled as JSON (`.tsj` / `.json`); the default `.tsx` XML format isn't supported by the loader.
