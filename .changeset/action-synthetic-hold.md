---
"@yagejs/input": minor
---

Add action-level synthetic hold injection. `fireActionDown` / `fireActionUp` / `setActionHeld` drive an action by name: they sustain `isPressed` across frames, emit a real `isJustReleased` edge, fire `onActionReleased`, and feed `getHoldDuration` — so synthetic devices like touch buttons and virtual controls can drive hold and charge actions with no keymap knowledge, symmetric to the physical-key `fireKeyDown` / `fireKeyUp` path.

`consumePointer` is now documented as the way to forward or replay a synthetic pointer to the canvas without leaking the tap into gameplay action edges.
