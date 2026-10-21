---
"@yagejs/lighting": patch
---

Add sprite materials with normal maps, specular highlights, and emission.

- `surfaceLighting()` is a lighting backend that lights each sprite on a world layer individually, with its normal map, specular highlights, and emission, before the sprite blends with what is behind it. It uses the scene's ambient light, lights, cones, and occluders. It requires WebGL2 or WebGPU and rejects bounce. Graphics, text, tilemaps, and particles keep their own colors under it.
- `LightSource.height` places a light above the sprite plane in pixels, default 64. It changes the direction of surface lighting only, not light-level queries or shadows.
- `shaderLighting()` spends less GPU time on the shadows of point lights (`size: 0`), and skips occluder edges that cannot block a pixel's view of a finite lamp.
- A lighting buffer that runs out of room names the buffer and its capacity in its error.
