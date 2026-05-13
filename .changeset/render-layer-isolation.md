---
"@yagejs/core": minor
"@yagejs/renderer": minor
---

Two layer-semantics fixes for scene + layer isolation.

`LayerDef.isRenderGroup` (renderer): opt-in flag that promotes a layer's container to a Pixi v8 render group, giving it its own uniform scope. Set it on layers that host filtered content AND on any sibling layer whose pipe reads `globalUniforms` directly (`@pixi/tilemap`'s `TilemapPipe.execute` pulls `_activeUniforms.at(-1)`, so a filter elsewhere in the tree can leak its `uWorldTransformMatrix` into the tilemap draw and visibly drift the canopy). Default: `false`.

`Scene.transparentBelow = false` (the default) is now actually enforced (core + renderer). Pushing an opaque scene on top of a stack hides every below-stack scene tree — world layers AND screen-space UI/HUD. The flag composes through the stack: a below scene stays visible only while every scene above it has `transparentBelow: true`. While a scene transition is running, both the outgoing and incoming scenes render regardless so `crossFade` and friends keep working; the chain is reapplied on `scene:transition:ended`. Previously the flag was documented but no code path enforced it, so UI from scenes below the active scene bled through.

Breaking: games that relied on the old (unenforced) behavior — below-stack UI continuing to paint through a pushed scene — must either set `transparentBelow = true` on the pushed scene or restructure as a `replace` instead of a `push`.
