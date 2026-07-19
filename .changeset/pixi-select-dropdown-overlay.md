---
"@yagejs/ui": patch
---

`PixiSelect`'s open dropdown now draws above all other UI.

`@pixi/ui`'s `Select` renders its dropdown list inline — a child of the Select at the Select's own z-position — so a sibling drawn later (a label under the Select, a panel below it) painted over the open list and intercepted its pointer events, leaving the lower options unhoverable and unclickable. The dropdown is now lifted to the top of the render tree while open (its on-screen position and scale preserved via the world transform) and dropped back on close, so options that overflow the Select's panel stay visible and interactive.
