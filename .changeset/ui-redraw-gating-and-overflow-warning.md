---
"@yagejs/ui": patch
---

Redraw a panel, button, progress bar or scroll view background only when its size or its options changed. Clip masks and the scroll view's thumb are gated the same way. A static UI tree previously rebuilt every rounded rectangle it contains on every frame, which was the package's largest per-frame allocation.

Background options are read when you pass them, not on every frame. Mutating the object you handed to `background` no longer reaches the screen; pass a new one to change the colour, the tint or the corner radius.

The development-mode overflow warning now names the entity that owns the tree, the child's position in its parent, its element class, and the text it renders: `UI layout [entity "Hud"]: child #2 (UIText "Score: 12500") overflows its container by 12.3px past the right edge.` An element built outside a `UISurface` prints the same message without the entity prefix.

The warning also tolerates two points of overflow instead of one and a half, which is the largest gap Yoga's own pixel-grid rounding can open between a measured text node and a shrink-to-fit parent at a fractional position. A shrink-to-fit panel holding one text child no longer warns about that child.
