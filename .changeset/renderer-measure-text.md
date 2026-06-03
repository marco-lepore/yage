---
"@yagejs/renderer": minor
---

Add `measureWrappedText(text, options)` + `MeasureTextOptions` / `MeasuredText` — a wrap-aware text-metrics primitive (canvas via `CanvasTextMetrics`; single-line on the bitmap path) that returns `{ width, height, lineCount }` without constructing a live text node. Reach for it to size a panel to its text (e.g. a content-sized dialogue bubble) instead of importing `pixi.js` directly — the same escape-hatch rationale as `createNineSlice`.
