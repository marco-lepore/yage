---
"@yagejs/renderer": minor
---

`NineSliceComponent` draws a stretchable textured frame as a scene visual.

- `new NineSliceComponent({ texture, insets, width, height, anchor?, ...visual options })` places the frame with the entity's `Transform`; `setSize(width, height)` stretches it. Sizes and insets throw when negative or non-finite.
- Breaking: `createNineSlice` and `NineSliceOptions` are not exported. Add a `NineSliceComponent` to an entity instead of parenting a raw nine-slice sprite into another visual.
