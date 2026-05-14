---
"@yagejs/renderer": minor
---

Renderer ergonomics: `RendererConfig.pixelArtPreset`, `CameraEntity.fit` / `centerOn`, and `LayerDef.sort` + `ySort` / `ySortBy` helpers.

- **`RendererConfig.pixelArtPreset?: boolean`** (default `false`). One flag flips `TextureStyle.defaultOptions.scaleMode = "nearest"`, `roundPixels: true` on the Pixi `Application`, and `image-rendering: pixelated` (with a `-webkit-optimize-contrast` Safari fallback) on the canvas element. Composes with `pixi: {...}` — explicit user overrides win.

- **`CameraEntityParams.fit?: "follow" | "static"`** (default `"follow"`). `fit: "static"` keeps the camera at its supplied `position` and silently drops any `follow` / `smoothing` / `offset` / `deadzone` so refactors that still pass those values don't accidentally re-enable tracking.

- **`CameraEntityParams.centerOn?: { width; height }`**. Convenience for placing the camera at the midpoint of a known area — applies last, overrides an explicit `position`.

- **`LayerDef.sort?: (a, b) => number`**. Per-frame paint-order comparator applied by `DisplaySystem` after transform sync, before camera transforms. Layers without a `sort` keep insertion order (current behavior). Setting `sort` also flips `container.sortableChildren = true` on the layer.

- **`ySort` / `ySortBy`** exported from `@yagejs/renderer`. `ySort` is `(a, b) => a.position.y - b.position.y` for the classic top-down 2D depth rule; `ySortBy(offsetOf)` adds a per-container offset to the sort key (the Godot `y_sort_origin` pattern) so anchored-at-top sprites can advertise their visual "footprint".
