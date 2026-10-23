---
"@yagejs/renderer": patch
---

A layer declared with `renderTarget` draws into a texture, not the screen, so game code fills a texture with ordinary visual components.

- Visuals join the layer with `layer: name` and follow their entity's `Transform`, in the texture's pixels. `texture: key` registers the texture while the scene lives, for a `SpriteComponent` to show; scene exit destroys the texture and unregisters the key.
- `refresh: "every-frame"` (the default) redraws the texture each frame, after every visual has taken its pose. `refresh: "on-demand"` redraws it only after `layer.renderTarget.invalidate()` or `resize()`.
- `RenderLayer.renderTarget` holds the layer's `LayerRenderTarget`: its texture, size, resolution, `invalidate` and `resize`.
- `RenderLayer.space` reads `"texture"` on a render-target layer, typed `RenderLayerSpace`. No camera binds such a layer, and a camera whose `bindings` names one throws when the camera is added.
- A render-target layer takes no `space`, the `"default"` layer cannot be one, and its size must be positive. A scene's declared layers are all checked when it enters, before any is created, so a bad declaration leaves no texture or key behind.
- When two live scenes register the same texture key, the key resolves the later scene's texture and goes back to the earlier one's when the later scene exits.
