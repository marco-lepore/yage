---
"@yagejs/renderer": minor
---

Split text hands out its characters, words and lines as `TextSegment`s.

- `TextSegment` holds what a game animates on a segment: `x`, `y`, `position`, `rotation`, `scale`, `alpha`, `tint` and `visible`.
- Breaking: `SplitTextComponent.chars`, `words` and `lines` return `readonly TextSegment[]`. Code that used a glyph's Pixi `Text`, `BitmapText` or `Container` API (`addChild`, `style`, `getBounds`) reads the Pixi glyphs through `renderObject.chars`.
