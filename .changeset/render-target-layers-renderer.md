---
"@yagejs/renderer": patch
---

A layer declared with `renderTarget` draws into a texture, not the screen, so game code fills a texture with ordinary visual components.

- Visuals join the layer with `layer: name` and follow their entity's `Transform`, in the texture's pixels. `texture: key` registers the texture while the scene lives, for a `SpriteComponent` to show; scene exit destroys the texture and unregisters the key.
- `refresh: "every-frame"` (the default) redraws the texture each frame, after every visual has taken its pose. `refresh: "on-demand"` redraws it only after `layer.renderTarget.invalidate()` or `resize()`.
- `RenderLayer.renderTarget` holds the layer's `LayerRenderTarget`: its texture, size, resolution, `invalidate` and `resize`.
- No camera binds a render-target layer, and naming one in a camera's `bindings` throws. A render-target layer takes no `space`, and the `"default"` layer cannot be one.
