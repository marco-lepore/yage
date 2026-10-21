---
"@yagejs/renderer": patch
---

Add sprite materials with normal maps, specular highlights, and emission.

- `SpriteComponent` and `AnimatedSpriteComponent` accept companion `maps` (normal, specular, emission) and a `material`. `litMaterial()` and `unlitMaterial()` create immutable, shareable definitions; `setMaterial()` replaces one sprite's.
- In a scene whose lighting backend shades sprites individually, every sprite on a world layer is lit, with or without maps. `unlitMaterial()` opts a sprite out. Elsewhere, a sprite without a material draws through Pixi's ordinary sprite path.
- `dataTexture()` loads PNG images whose channels are numbers, without color conversion or premultiplied alpha, for normal and specular maps.
- Grid sheets and single-page atlas animations carry their maps in the frame source. `AnimatedSpriteComponent.setSource()` replaces frames and maps together, and `AnimationController` switches both on every transition.
- Lit sprites keep their tint, alpha, blend mode, masks, effects, and draw order. Adjacent sprites with matching settings share a draw call.
- `AnimatedSpriteComponent` and `AnimationController` release the frame views they slice from a grid sheet when replaced or destroyed.
- `RendererPlugin.captureCanvas()` returns the rendered pixels on WebGPU devices whose canvas format differs from the render target's, such as Linux.
