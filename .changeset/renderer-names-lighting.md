---
"@yagejs/lighting": patch
---

The package documentation names all three built-in renderers: `overlayLighting()`, `shaderLighting()`, and `surfaceLighting()`.

- The README describes `surfaceLighting()` beside the other two renderers and says a `LightOccluder` blocks light in all three.
- The JSDoc of `OverlayLightingRendererOptions` and `overlayLighting()` names the overlay renderer.
- The JSDoc of `OverlayLightingRenderer` and `ShaderLightingRenderer` says the overlay and shader renderers share `LightingComposite`.
- `AmbientLightOptions.color` is documented as the tint of ambient light in the drawn picture.
