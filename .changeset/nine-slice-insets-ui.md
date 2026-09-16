---
"@yagejs/ui": patch
---

A panel that replaces one piece of nine-slice background art with another draws the new art with its own slice guides. The four `nineSlice` insets are applied every time the texture is applied, so the corners and the stretchable middle sit where the new art's insets put them. This release draws such a panel differently; where the two pieces of art declare the same insets, the drawing is identical.

The insets are read from the background options, not from the texture's own metadata, so pass `mode` and `nineSlice` again when you swap art. Options you leave out go back to their defaults: without `nineSlice` the insets are 0, and without `mode` the background becomes a stretched sprite.

The development-build warning for a nine-slice box with no room for its own middle row or column measures against the insets currently applied, so a box that had room for small insets warns when it is given art with larger ones.
