---
"@yagejs/lighting": minor
---

Add sprite materials with normal maps, specular highlights, and emission.

- Add `surfaceLighting()` through the existing named backend configuration. It shades individual sprites with ambient light, radial lights, cones, and occluders before alpha blending.
- Add positive pixel `LightSource.height`, defaulting to 64, for surface light direction without changing light-level queries or shadow geometry.
- Share shadow evaluation and shape preparation with the shader compositor. Skip unchanged light-data uploads and reject unsupported bounce or GPU configurations explicitly.
- Use direct segment intersections for point-light shadows and skip edges outside the pixel-to-lamp region before soft-shadow projection in both GPU lighting backends.
- Skip shadow evaluation for back-facing surface lights and specular work for fully shadowed pixels.
