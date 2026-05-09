---
"@yagejs/renderer": minor
---

Add four scene transitions: `iris` (close-then-open dip-to-color, retro Zelda style), `irisReveal` (one-way circular reveal of the destination), `chessboard` (staggered cell-by-cell mask reveal), and `slidePush` (incoming and outgoing scenes translate in lockstep). All four size their masks/translations against `renderer.virtualSize` so they line up correctly with the scene root under any responsive-fit ratio. `IrisOptions.center` and `IrisRevealOptions.center` are documented as virtual-space pixels.
