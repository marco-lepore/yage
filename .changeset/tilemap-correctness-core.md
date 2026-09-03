---
"@yagejs/core": patch
---

`Transform` can convert a world-space point into an entity's own local space.

- `Transform.worldToLocal(point)` converts a world-space point into the
  entity's own local space, reversing its world position, rotation and scale.
  Use it to ask where a world point falls inside an entity that is parented,
  rotated or scaled. On an axis whose world scale is 0 the result is
  non-finite, because the world transform collapses that axis.
- The `worldPosition` setter back-computes the local position through the
  parent's `worldToLocal`, so the inverse transform is written once.
