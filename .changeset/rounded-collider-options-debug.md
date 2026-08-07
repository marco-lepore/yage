---
"@yagejs/debug": patch
---

Rounded box colliders and contact skins, so a walking body stops catching on terrain polyline junctions.

- `DebugGraphics` gains `roundRect(x, y, width, height, radius)`, matching the PixiJS method of the same name, so a contributor can outline a rounded shape in one call. The physics overlay uses it to draw rounded box colliders.
- A hand-written `DebugGraphics` stub, such as one in a custom contributor's tests, needs a `roundRect` entry to satisfy the interface.
