---
"@yagejs/renderer": minor
---

Let the auto-created `"default"` render layer be configured and sorted.

- Declaring a `LayerDef` named `"default"` now configures the pre-created order-0 layer (its `sort`, `space`, `isRenderGroup`) instead of being silently ignored — so `{ name: "default", sort: ySort }` depth-sorts the layer entities already render on, with no per-component `layer` wiring. The declared `order` is still pinned to 0.
- Added `RenderLayer.setSort(fn)` to opt a layer into (or out of) a depth-key at runtime; it flips `container.sortableChildren` to match. Pass `undefined` to revert to insertion order.
