---
"@yagejs/renderer": minor
---

Renderer ergonomics: `RendererConfig.pixelArtPreset`, `CameraEntity.fitTo`, and `LayerDef.sort` + `ySort` / `ySortBy` helpers.

- **`RendererConfig.pixelArtPreset?: boolean`** (default `false`). One flag flips `TextureStyle.defaultOptions.scaleMode = "nearest"`, `roundPixels: true` on the Pixi `Application`, and `image-rendering: pixelated` (with a `-webkit-optimize-contrast` Safari fallback) on the canvas element. Composes with `pixi: {...}` — explicit user overrides win. The `TextureStyle` global is captured on install and restored on destroy so the mutation stays scoped to the plugin's lifetime.

- **`CameraEntityParams.fitTo?: { x; y; width; height }`**. Frames an axis-aligned world rectangle by setting both `position` (the rect's centre) and `zoom` (`contain` semantics — `min(viewportW / rect.w, viewportH / rect.h)`) at setup. Overrides explicit `position` / `zoom` when supplied. The right primitive for fixed-camera scenes (puzzle boards, arcade levels, dialog-scene insets) where the framed area is known up front and zoom matters as much as position.

- **`LayerDef.sort?: (c: Container) => number`**. Per-frame **depth-key** function. `DisplaySystem` writes `child.zIndex = sort(child)` on every direct child of the layer, and the layer container's `sortableChildren` is flipped to `true` so Pixi's render pipeline orders by zIndex. Layers without a `sort` keep insertion order. Composes with manual `child.zIndex` writes — a depth-key fn handles the bulk; individual sprites can still write their own zIndex between frames for one-off bias.

- **`ySort` / `ySortBy`** exported from `@yagejs/renderer`. `ySort` is `(c) => c.position.y` for the classic top-down 2D depth rule; `ySortBy(offsetOf)` adds a per-container offset to the depth key (Godot's `y_sort_origin` pattern) so anchored-at-top sprites can advertise their visual "footprint".

- **Removed** `LayerDef.sortableChildren` — subsumed by `sort` (which enables auto-sort internally). Game code that wants Pixi's pure zIndex auto-sort without a depth-key fn can write `tree.get(name).container.sortableChildren = true` directly; the redundant declarative field is gone.
