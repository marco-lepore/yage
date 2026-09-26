---
"@yagejs/lighting": patch
---

The `LightOccluder` documentation says both built-in renderers, `overlayLighting()` and `shaderLighting()`, and the light-level queries treat an enabled occluder as opaque to shadow-casting lights, instead of naming only the overlay renderer.
