---
"@yagejs/renderer": minor
---

Split text hands out its characters, words and lines as `TextSegment`s.

- `TextSegment` holds what a game animates on a segment: `x`, `y`, `position`, `rotation`, `scale`, `alpha`, `tint` and `visible`.
- Breaking: `SplitTextComponent.chars`, `words` and `lines` return `readonly TextSegment[]` instead of Pixi `Text`, `BitmapText` and `Container` arrays. Code that reached a glyph's Pixi API (`addChild`, `style`, `getBounds`) reads it through `renderObject.chars`.
