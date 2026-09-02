---
"@yagejs/tilemap": minor
---

Remove `TilemapComponent` snapshot methods and serialized data types. Persist
the map identity and game-owned mutations explicitly, then reconstruct the
tilemap from its asset. The parsed map (`data`) stays out of Inspector
component state.
