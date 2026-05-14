---
"@yagejs/tilemap": patch
---

Fix tilemap drift when a sibling layer renders a filter (`hitFlash`, `bloom`, etc.). `TilemapPlugin.install` now runtime-patches `@pixi/tilemap`'s `TilemapPipe.execute` to read the currently-bound uniform group instead of `renderer.globalUniforms._activeUniforms.at(-1)` (which is the per-frame push log and stays populated after a filter pops, so subsequent tilemap draws were picking up the filter's leftover `uWorldTransformMatrix`). The patch also swaps `tilemap.worldTransform` for `tilemap.groupTransform` to match what Pixi's own `SpritePipe` / `GraphicsPipe` do — Pixi populates `worldTransform` as `parentRG.worldTransform × relativeGroupTransform` when the tilemap sits inside a sub-render-group, so combining it with `uWorldTransformMatrix` would double-apply the camera + fit transform.

The patch is applied once in `TilemapPlugin.install` and is idempotent. Targets `@pixi/tilemap@5.0.2`; the dependency is now pinned to that exact version so a transparent minor bump can't silently change the pipe shape under us.
