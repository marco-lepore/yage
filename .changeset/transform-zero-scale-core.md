---
"@yagejs/core": patch
---

Fix `Transform.worldPosition` writing `Infinity`/`NaN` into the local position when an ancestor has a zero scale component.

- On an axis where the parent's world scale is 0, the setter keeps the child's local value unchanged instead of dividing by zero. Nothing under a flattened parent can move along that axis, so the entity keeps rendering at the parent's origin and recovers a correct pose as soon as the scale is non-zero again.
- A dev-mode warning reports which axis could not take the assignment.
