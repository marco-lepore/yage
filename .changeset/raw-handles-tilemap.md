---
"@yagejs/tilemap": minor
---

`TilemapComponent` hands out its Pixi object under one name, `renderObject`.

- Breaking: `TilemapComponent.container` is removed. Change the map through the component's `visible`, `alpha`, `tint`, `fx` and `setMask`.
