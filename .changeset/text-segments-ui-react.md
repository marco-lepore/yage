---
"@yagejs/ui-react": minor
---

Split text hands out its characters, words and lines as `TextSegment`s.

- Breaking: `useSplitText()`'s `chars`, `words` and `lines` hold `readonly TextSegment[]`. A segment has no Pixi `Text`, `BitmapText` or `Container` API.
