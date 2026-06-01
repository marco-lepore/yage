---
"@yagejs/renderer": minor
---

Add a nine-slice primitive: `createNineSlice(options)` + `NineSliceOptions`, and re-export the `NineSliceSprite` type. Resolves a `TextureInput` and returns a configured stretchable frame whose corners stay crisp at any size — the same raw-display-object escape hatch as `resolveTexture`. Lets addons and games build textured panels/frames/buttons through `@yagejs/renderer` instead of importing `pixi.js` directly.
