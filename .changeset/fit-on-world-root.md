---
"@yagejs/renderer": minor
---

Move the responsive `fit` transform off `app.stage` and onto a dedicated `_worldRoot` container that sits between stage and per-scene roots. Stage stays at identity; the world root carries scale/offset.

Why: Pixi v8 feeds the active render group's transform to shaders via `uWorldTransformMatrix`. `@pixi/tilemap`'s pipe composes `uProjection × uWorldTransformMatrix × tilemap.worldTransform`, but `tilemap.worldTransform` is already cumulative from root — so any non-identity transform on the active render group is applied twice, silently mis-scaling tile rendering relative to Sprites/Graphics (whose batched renderer pre-transforms vertices on CPU and doesn't read `uWorldTransformMatrix`). The bug only manifested at fit ratios ≠ 1 with non-trivial camera zoom, which is why it stayed hidden on desktop and surfaced as a tile/object misalignment on mobile.

Putting the fit transform on a regular Container child of stage keeps `uWorldTransformMatrix = identity` at render time, so `@pixi/tilemap`'s pipe — and any other shader that reads `uWorldTransformMatrix` — composes correctly. Stage-direct children (transition overlays, the screen-scope `RendererPlugin.fx` host) keep their canvas-pixel coordinates as before.

User-visible surface is unchanged — `canvasToVirtual`, `hitTestUI`, scene render trees, and the `Fit` controller's outputs are all the same. The only structural change is one extra container in the tree (`stage → _worldRoot → scene roots`).
