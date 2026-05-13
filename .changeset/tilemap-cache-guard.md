---
"@yagejs/tilemap": patch
---

Guard the Tiled tileset subtexture cache against duplicate keys.

`tiledMapLoaderParser` called `Assets.cache.set(cacheKey, subtex)` unconditionally for every tile on every load — re-loading the same map (or two maps that share a tileset) triggered Pixi's `[Cache] already has key` warning and re-allocated subtextures the cache already held. The loader now skips both the `Texture` construction and the `cache.set` when the key already exists.

Also documented the JSON-tileset requirement: tilesets must be exported from Tiled as JSON (`.tsj` / `.json`); the default `.tsx` XML format isn't supported by the loader.
