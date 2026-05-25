---
"@yagejs/core": minor
"@yagejs/renderer": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Web-font asset handle, engine-level default text style, and bitmap-font DX.

- New `webFont(path, { family })` asset factory (wired as the renderer `"web-font"` loader) — a declarative `AssetHandle` for loading a plain `.ttf`/`.woff`/`.woff2` as a canvas `Text` font, resolvable through `Scene.preload` (the canvas sibling of `bitmapFont`). The `family` registers the `@font-face`; omit it to let Pixi derive it from the file name. To carry that metadata, `AssetHandle` gains an optional third `data` argument, forwarded to `AssetLoader.load(path, data)` (backward-compatible — existing loaders ignore it).
- Engine-level default text style: `RendererConfig.defaultTextStyle` sets an app-wide base under every `TextComponent` / `UIText` `style`, and `UIPlugin({ defaultTextStyle })` layers a UI-only override on top. Precedence: per-text `style` → `UIPlugin` default → `RendererPlugin` default → Pixi default. Re-applied on `setStyle` so a recolour keeps it — no more importing `pixi.js` to touch `TextStyle.defaultTextStyle`. The renderer-level mutation is captured/restored on plugin destroy, like `pixelArtPreset`.
- `bitmap` is now a plain `boolean` on `TextComponent` / `UIText` / `<Text>` / `UIButton` (**breaking**: the `{ font, size }` object form is removed, and the `BitmapTextOption` type is no longer exported). The bitmap font is a normal style property — pass the installed/baked font name as `style.fontFamily` (and the glyph size as `style.fontSize`) alongside `bitmap: true`. `installBitmapFont` still returns that name.
- New `mergeStyle(style)` on `TextComponent` / `UIText`: patches the current style instead of replacing it, so an imperative recolour (`mergeStyle({ fill })`) keeps the font, size, weight, etc. `setStyle` remains a full replace (the semantics the React reconciler relies on).
- `bitmap` DX: passing `bitmap` nested inside `style` (a silent no-op before) now emits a dev-mode warning, surfaced on every construction and `setStyle` path. `UIButton` and the React `<Button>` forward a `bitmap` boolean to their auto-wrapped string label (no effect when the child is a composed element).
- Bitmap text no longer loses its font on re-render / recolour (#86): the font now lives in `style.fontFamily` (a normal style property carried on every re-apply), and `mergeStyle` preserves it on an imperative recolour — superseding the construction-time `bitmap.font → fontFamily` fold.
- `installBitmapFont` bakes glyphs **white** by default (#87) instead of Pixi's black `TextStyle` default, so a per-text `fill` / `tint` (a multiply over the atlas) recolours them out of the box — `black × tint = black` otherwise. An explicit `style.fill` still wins.
