---
"@yagejs/renderer": minor
---

Add sprite materials with normal maps, specular highlights, and emission.

- Add immutable `litMaterial` and `unlitMaterial` definitions to static and animated sprites, with existing tint, alpha, masks, and effects.
- Add `dataTexture` PNG assets for numeric normal/specular channels, with independent color/data cache entries and scene-owned lifetime.
- Bind companion maps to texture and animation sources. Add `AnimatedSpriteComponent.setSource`, preserve maps through controller transitions, and release owned frame views on replacement and destruction.
- Draw material sprites through WebGL2/WebGPU while preserving their public Sprite objects and expose settings through the Inspector render facet.
- Batch adjacent compatible sprites while preserving transparency order, individual tint/alpha/transforms, and filter or mask boundaries.
- Match WebGPU canvas and render-target pixel formats so Linux captures contain rendered pixels.
