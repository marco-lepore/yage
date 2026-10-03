---
"@yagejs/ui": minor
---

Inherit UI input consumption through the display tree.

Make omitted `consumeInput` values inherit through every UI element, including Pixi widgets. A select applies its explicit setting to its portaled list as well; an omitted setting there uses the standalone UI default. `UISurface` and standalone UI default to consuming. Set `consumeInput: true` on controls inside a transparent subtree to keep their presses out of gameplay. Removing an override restores inheritance; pointer callbacks remain active.
