---
"@yagejs/renderer": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

BitmapText path for pixel-art text + per-text `resolution`.

- `TextComponent` and `UIText` accept a new `bitmap?: boolean | { font?: string; size?: number }` option. `true` bakes a dynamic bitmap font from the text's own `style`; the object form renders with an installed/loaded font by name (`size` overrides the glyph size). Canvas-rasterised Pixi `Text` is bilinear-sampled and goes blurry at non-integer scale on non-Retina displays — `BitmapText` draws crisp pre-baked glyph quads instead. Yoga measurement (the PR #67 word-wrap / `truncate` semantics) is unchanged on the bitmap path.
- New `bitmapFont(path)` asset factory (wired into the renderer asset pipeline as the `"bitmap-font"` loader) for BMFont `.fnt`/`.xml` + atlas descriptors, plus an async `installBitmapFont(source, opts)` helper that loads a `.ttf` and bakes a glyph atlas via Pixi v8's `BitmapFont.install`, returning the registered font name.
- New `resolution?: number` constructor option on `TextComponent` / `UIText` (and the React `<Text>` wrapper). Pixi v8 `resolution` is a `Text` constructor option, NOT a `TextStyle` property — this is the only way to get crisp canvas text without a prototype patch. Ignored when `bitmap` is set (bitmap resolution is fixed at font-bake time).
- `TextComponent` serialization round-trips `bitmap` and `resolution`. `@yagejs/ui-react`'s `TextProps` gains the same two props.
- `bitmap` / `resolution` are construction-only — Pixi v8 can't morph `Text`↔`BitmapText` or change `resolution` in place. `UIText.update()` (the React reconciler path) emits a dev-mode warning when either changes instead of silently dropping it; remount the element (e.g. change its React `key`) to switch.
