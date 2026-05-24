---
"@yagejs/renderer": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Add `SplitTextComponent` for per-glyph / animated text.

Wraps Pixi v8's experimental `SplitText` / `SplitBitmapText` and exposes the text as arrays of individually transformable display objects — `chars` (per-glyph `Text` / `BitmapText`), `words`, and `lines` — for typewriter reveals, per-letter colour / wave, and staggered line entrances. Transform-synced and layer-attached like `TextComponent`, with the same `bitmap` discriminator (canvas `SplitText` vs `SplitBitmapText`).

API: `chars` / `words` / `lines` getters, `setText` / `setStyle`, `charAnchor` / `wordAnchor` / `lineAnchor` segment pivots (get/set, settable at construction), `resplit()` for batching updates under `autoSplit: false`, `tint` / `alpha`, and the underlying `splitText` escape hatch. Serializable (text / style / bitmap / anchors / layer / tint / alpha / visible; re-splits on restore).

`SplitText` is flagged experimental in Pixi and re-lays-out on every `text` / `style` change — prefer `TextComponent` for static or simple dynamic strings.
