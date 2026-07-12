---
"@yagejs/tilemap": minor
---

Unify the five visual components' options, delete the raw-texture escape
hatches, and stop leaking raw `pixi.js` types from public signatures.

- `TilemapComponent.container` is now typed as `@yagejs/renderer`'s
  `DisplayContainer` alias instead of a raw `pixi.js` import. Type-only
  change — the field still holds the real Pixi `Container`.
