---
"@yagejs/tilemap": minor
---

Tiled collision-shape extraction and physics/debug correctness fixes, plus collider rotation support.

- Object rotation is honored during collision extraction (it was previously ignored): polygon, polyline, and sampled-ellipse vertices come out rotated; a rotated circle's position shift is baked into `x`/`y`; rect and capsule configs carry a new optional `rotation` (radians) that `toPhysicsColliders` forwards to the physics collider, with the center offset rotated about the Tiled pivot.
- Tiled polygon objects now emit a closed polyline: the first vertex is appended at the end, so the boundary's closing edge collides instead of leaving a gap.
- Non-circular Tiled ellipses are approximated with a 24-vertex convex polygon instead of collapsing to a circle with the wider radius. Circular ellipses still emit an exact `circle`.
- Tiled polyline objects are now extracted as open polyline colliders (previously they fell through to a degenerate 0×0 rect). `MapObject` carries the new optional `polyline` vertex list.
