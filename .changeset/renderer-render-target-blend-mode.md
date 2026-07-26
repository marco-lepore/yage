---
"@yagejs/renderer": minor
---

Offscreen render targets and a `blendMode` option on every visual component — the two pieces needed to composite objects against each other before they reach the screen.

- **`renderer.createRenderTarget(source, options)`** draws a container into a texture your game owns and redraws on a schedule you control: `invalidate()` marks it stale, `renderIfNeeded()` draws only when something changed, `render()` forces a draw. `resolutionScale` trades texels for cost, so a half-scale light or blur buffer is a one-line change. It is the repeatable counterpart of `createTexture`, which bakes a texture once. Content is drawn in the source container's own coordinate space — the camera and the responsive `fit` transform do not reach it, so a buffer that must follow the camera positions its own children through `camera.worldToScreen()`.
- **`blendMode`** on `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`, and `SplitTextComponent`, as both a constructor option and a live accessor. It is typed as `BlendMode` from `@yagejs/renderer`, so reaching the raw Pixi display object for the mode union is no longer necessary. Pixi constructs display objects at `"inherit"` rather than `"normal"`, and the two differ under a non-normal parent, so `serialize()` omits the field only when it is `"inherit"` and an explicit `"normal"` survives a round trip. The photoshop-style modes (`"darken"`, `"overlay"`, `"color-dodge"`, ...) need `import "pixi.js/advanced-blend-modes"` in the game's entry file; the GPU-native ones, `"erase"` included, need nothing.

`"erase"` composites against whatever framebuffer it is drawn into, so cutting a hole in one object rather than the whole scene means drawing both into a render target. Blend behaviour inside a render target is verified on the WebGL backend and unmeasured on WebGPU.
