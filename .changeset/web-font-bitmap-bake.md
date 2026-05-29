---
"@yagejs/renderer": minor
---

Add a declarative `bitmap` option to `webFont` so one declared font is usable as both canvas `Text` and `BitmapText` under a single family. Pass `bitmap: true` (or a `WebFontBakeOptions` object — `{ size?, chars?, resolution?, padding?, style?, variants? }`) to bake a glyph atlas from the loaded face during `preload`; the canvas face and baked atlas share the font's `family` across Pixi's separate registries. Unloading the web font uninstalls every baked atlas alongside the canvas face. Closes #101.
