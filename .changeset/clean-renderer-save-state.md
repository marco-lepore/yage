---
"@yagejs/renderer": minor
---

Remove component snapshot methods, snapshot data types, runtime effect and mask
restoration registries, and the optional `@yagejs/save` integration. Rebuild
renderer resources from explicit game state when constructing a scene.

Add `TextComponent.content`, which reads the displayed string back — `.text`
holds the pixi display object, so this is what the Inspector reports for a
`TextComponent`.
