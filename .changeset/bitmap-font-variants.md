---
"@yagejs/renderer": minor
---

Add synthetic bold/italic for bitmap fonts via `installBitmapFont({ variants })`.

`installBitmapFont` now accepts a `variants` array (`BitmapFontVariant[]`) that bakes weight/style emphasis atlases from the same source `.ttf` alongside the base font. A `BitmapText` whose `style.fontWeight` / `fontStyle` asks for bold or italic then renders from the matching atlas automatically — previously those props were honoured only by canvas `Text` and silently ignored by `BitmapText`.

All baked variants are baseline-aligned to the base atlas (`baseLineOffset` + `lineHeight` normalized at bake time), so a bold span and regular text sit on one shared baseline with no vertical drift when mixed on a line.
