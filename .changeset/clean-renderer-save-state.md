---
"@yagejs/renderer": minor
---

Remove component snapshot methods, snapshot data types, runtime effect and mask
restoration registries, and the optional `@yagejs/save` integration. Rebuild
renderer resources from explicit game state when constructing a scene.

Add `TextComponent.content` and `SplitTextComponent.content`, which read the
displayed string back — `.text` / `.splitText` hold the pixi display object, so
these are what the Inspector reports for those components.
