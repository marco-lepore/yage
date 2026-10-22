---
"@yagejs/ui-react": minor
---

Split text hands out its characters, words and lines as `TextSegment`s.

- Breaking: `useSplitText()`'s `chars`, `words` and `lines` hold `readonly TextSegment[]` instead of Pixi `Text`, `BitmapText` and `Container` arrays.
