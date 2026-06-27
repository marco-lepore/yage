---
"@yagejs/renderer": minor
---

Add `measureWrappedText(text, options)` + `MeasureTextOptions` / `MeasuredText` — a wrap-aware text-metrics primitive that returns `{ width, height, lineCount }` without constructing a live text node. Reach for it to size a panel to its text (e.g. a content-sized dialogue bubble) instead of importing `pixi.js` directly — the same escape-hatch rationale as `createNineSlice`. Wrap-aware on both paths: canvas via `CanvasTextMetrics`, bitmap via `BitmapFontManager` with the atlas's base-unit metrics scaled to `fontSize` (matching what a `BitmapText` renders at). Measurement resolves the engine-level `defaultTextStyle` under the given options — the same merge the render path applies — and reuses one internal `TextStyle` so identical repeated measures can hit pixi's metrics cache.
