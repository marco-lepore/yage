---
"@yagejs/renderer": patch
---

Fix `fade`, `flash`, and `iris` fullscreen overlays under responsive fit on top of the world-root architecture. The previous PR sized them from `renderer.virtualSize`, which was correct while the fit transform sat on `app.stage` — but the fit moved onto `_worldRoot` in #59, so `app.stage` is now identity and direct stage children operate in canvas/CSS pixels. The three overlays are parented to `app.stage`, so they now read from `app.screen.width/.height` again. `IrisOptions.center` is documented (and consumed) in canvas pixels accordingly. The scene-root transitions (`chessboard`, `irisReveal`, `slidePush`) continue to use `getVirtualBounds(ctx)` because they manipulate scene roots, which still live under the fit transform.

The `getVirtualBounds(ctx)` helper docs and the transition author guides now spell out the rule: pick the size source by where you `addChild` — scene root → virtual; `app.stage` direct → canvas pixels.
