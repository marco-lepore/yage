---
"@yagejs/tilemap": minor
---

Tiled collision-shape extraction and physics/debug correctness fixes.

- Tiled polygon objects now emit a closed polyline: the first vertex is appended at the end, so the boundary's closing edge collides instead of leaving a gap.
- Non-circular Tiled ellipses are approximated with a 24-vertex convex polygon instead of collapsing to a circle with the wider radius. Circular ellipses still emit an exact `circle`.
- Tiled polyline objects are now extracted as open polyline colliders (previously they fell through to a degenerate 0×0 rect). `MapObject` carries the new optional `polyline` vertex list.
