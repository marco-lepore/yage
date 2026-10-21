---
"@yagejs/lighting": minor
---

Report what the graphics context can do, and bring YAGE's drawing back after a lost context.

- `Breaking:` `shaderLighting()` with no `fallback` draws a WebGL 1 context with `overlayLighting()`, in the same layer and order and with the same `resolutionScale` when one is set. A game that wants another outcome there passes its own `fallback`, or reads `renderer.capabilities.backend` and picks a renderer itself.
- A WebGL 2 driver that refuses to build the light program gets the fallback too. The renderer compiles and links that program once per graphics context, which takes a few milliseconds and leaves the result in the browser's own cache for the draw that follows. A WebGPU device is not tested: its shader errors arrive after a scene has started drawing.
- Bounce `"max"` is drawn as `"mix"` where `renderer.capabilities.blendMinMax` is `"unsupported"`, which is a WebGL 1 context without `EXT_blend_minmax`. A development build warns once per scene that the blend was substituted, and a context that replaces a lost one is read again, so the picture follows what that context can blend.
- `Breaking:` `LightingCompositeOptions` takes the scene's `world`, which a renderer factory is handed. The composite reports the bounce blend it draws to that world, and the `"lighting"` extension reads it there. A scene whose renderer builds no composite reports the blend its graphics context implies.
- The light buffers keep the display's pixel ratio, so a window moved to a display with another ratio redraws them at the new density. The lighting pass also redraws after a lost graphics context is restored.
- With an Inspector installed, the `"lighting"` extension answers `scenes()` with one entry per live scene: the configured renderer it asked for, why a fallback drew it, and the bounce blend asked for beside the one drawn. The types are `LightingDiagnostics`, `LightingSceneDiagnostics` and `LightingFallbackReason`.
- `Breaking:` requires `pixi.js` 8.22.0 or later.
