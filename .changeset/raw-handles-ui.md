---
"@yagejs/ui": minor
---

UI elements hand out their Pixi object under one name, `displayObject`.

- Breaking: the `container` fields of `UIPanel`, `UIButton`, `UINineSlice`, `UIProgressBar` and `UICheckbox`, `UISurface.container`, `UISplitText.splitText` and `UIImage.sprite` are removed. Change an element through its props and methods; `surface.root` is the surface's root panel.
