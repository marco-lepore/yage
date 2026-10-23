---
"@yagejs/renderer": minor
---

`LayerDef` is either an `OnScreenLayerDef`, which draws on screen at its `order`, or a `RenderTargetLayerDef`, which draws into a texture and has no `order` or `space`.

- Breaking: `LayerDef` is a union type. Code that reads `order` from a `LayerDef` gets `number | undefined`; type the value `OnScreenLayerDef` when it always draws on screen. An interface cannot extend `LayerDef`; extend `OnScreenLayerDef` instead.
- `RenderLayer.order` is `0` on a render-target layer, where it has no effect.
