---
"@yagejs/tilemap": minor
---

Component lookup and queries match subclasses, so a base class can name a family.

- Breaking: `TilemapRenderSystem` is removed, along with its export and its
  registration. `TilemapComponent` extends `VisualComponent`, so `DisplaySystem`
  syncs it directly. Draw order comes from the render tree and `zIndex`, which
  the removed system did not affect.
- A tilemap in a depth-sorted layer keys off its unmodified position, so a
  render-only modifier offset no longer shifts its depth.
