---
"@yagejs/renderer": patch
"@yagejs/ui": patch
---

Fix two silent bitmap-font bugs.

- A bitmap-font text node reverted to the default canvas family the first time it re-rendered or recoloured: the `bitmap.font → fontFamily` fold only ran at construction, so `TextComponent.setStyle` and `UIText.setStyle` / `update` re-applied the raw `style` (no `fontFamily`) and Pixi `BitmapText` fell back to the default. The fold (extracted as `foldBitmapStyle`) now re-runs on the update paths using each node's cached `bitmap` option.
- `installBitmapFont` baked glyphs black by default (Pixi's `TextStyle` default), so a per-text `fill` / `tint` — a multiply over the atlas — produced `black × tint = black`. The bake `fill` now defaults to white so tinting works out of the box; an explicit `style.fill` still wins.
