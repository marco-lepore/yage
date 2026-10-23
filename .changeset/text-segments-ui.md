---
"@yagejs/ui": minor
---

Split text hands out its characters, words and lines as `TextSegment`s.

- Breaking: `UISplitText.chars`, `words` and `lines`, and the `TextSegments` an `onSplit` listener receives, hold `readonly TextSegment[]`. A segment has no Pixi `Text`, `BitmapText` or `Container` API.
