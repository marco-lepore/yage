---
"@yagejs/renderer": minor
---

`FrameSource` sheet slicing covers multi-row grid sheets: the sheet variant (renamed `SheetFrameSource`, with `isSheetSource`; previously `StripFrameSource`/`isStripSource`) gains the full uniform-grid options (`count`, `columns`, `startX`, `startY`, `gapX`, `gapY`), so `AnimatedSpriteComponent` and `AnimationController` can address any frame grid serializably — a plain `{ sheet, frameWidth }` still reads the single top row. The shared slicer is exported as `sliceGrid(texture, options)`; `sliceSheet` and `sliceTextureFrames` delegate to it unchanged.
