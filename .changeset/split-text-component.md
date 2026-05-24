---
"@yagejs/renderer": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Add split text for per-glyph / animated text — typewriter reveals, per-letter colour / wave, staggered line entrances.

Wraps Pixi v8's experimental `SplitText` / `SplitBitmapText` and exposes the text as arrays of individually transformable display objects — `chars` (per-glyph `Text` / `BitmapText`), `words`, and `lines`.

- **`@yagejs/renderer` — `SplitTextComponent`** (free-positioned, Transform-synced, layer-attached like `TextComponent`). `chars` / `words` / `lines` getters, `setText` / `setStyle`, `charAnchor` / `wordAnchor` / `lineAnchor` segment pivots, `resplit()` for batching under `autoSplit: false`, `tint` / `alpha`, the underlying `splitText` escape hatch, and the `bitmap` discriminator. Serializable.
- **`@yagejs/ui` — `UISplitText`** (Yoga-laid-out UI element). Same segment API plus an `onSplit` subscription that fires whenever a re-split invalidates `chars`. Measures its natural size via Pixi's text metrics (stable under per-glyph animation). No `truncate` / word-wrap — pre-break with `\n` or use `UIText` for flowing paragraphs.
- **`@yagejs/ui-react` — `<SplitText>` + `useSplitText`**. The hook is animation-agnostic: it owns the segment lifecycle (current segments + rebind-with-cleanup across re-splits) and leaves *how* you animate to the engine's `Tween` / `Process` or any other driver.

`SplitText` is flagged experimental in Pixi and re-lays-out on every `text` / `style` change — prefer `TextComponent` / `UIText` for static or simple dynamic strings.
