---
"@yagejs/renderer": minor
---

Report what the graphics context can do, and bring YAGE's drawing back after a lost context.

- `Breaking:` the renderer draws with WebGL or WebGPU only. On a browser that offers neither, `engine.start()` rejects with Pixi's `No available renderer for the current environment`, and `pixi: { preference: "canvas" }` throws from the plugin's constructor. Pixi's Canvas 2D renderer draws no light, skips every filter and ignores inverse masks, so a game that reached it ran half-drawn without saying so.
- `Breaking:` requires `pixi.js` 8.22.0 or later. Pixi 8.21.0 throws when nested filters draw after the renderer resizes, and 8.16.0 to 8.17.1 corrupt filters and render textures on iOS 18.0 and 18.1. Pixi 8.22 turns on its accessibility layer when the player presses Tab on a fresh page; pass `pixi: { accessibilityOptions: { activateOnTab: false } }` to keep Tab for the game.
- `renderer.capabilities` is one frozen snapshot of the graphics context the renderer draws with: `backend`, the texture, render-target and viewport limits, the sample count of an antialiased render target, fragment precision, min/max blending, and sample, filter and render support for the two float colour formats. `GraphicsCapabilities`, `GraphicsBackend` and `GraphicsFormatSupport` are exported from the package and from the `@yagejs/renderer/api` entry, which loads no Pixi.
- `renderer.contextLost` and the `graphics:context` event report a lost context and its restore. Each event arrives at the start of the next frame, before the game loop runs. Both members are readable from the renderer's install to `engine.destroy()`; outside that span each fails with `RendererPlugin.<member>: the graphics context is only known from the renderer's install to engine.destroy().`
- After a restore, every live render target draws from its source again at the next frame, inputs before the targets that sample them, and every `createTexture` result draws from the drawing it keeps. Destroying such a texture frees the drawing with it.
- `RenderTargetOptions.followResolution` (default `false`) re-allocates a buffer at the renderer's new resolution and redraws it at the next frame, for a buffer that should stay as sharp as the canvas.
- `antialias` on a render target has no effect where `capabilities.maxSamples` is `0`, and the buffer is allocated without it rather than with Pixi's per-buffer console warning.
- With an Inspector installed, the `"graphics"` extension answers `capabilities()` and `contextLost()`. Its type is `GraphicsDiagnostics`.
