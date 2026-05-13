---
"@yagejs/physics": patch
---

`PhysicsDebugContributor` now draws convex polygon colliders.

The wireframe pass only handled `Ball`, `Cuboid`, and `Capsule` — polygon shapes (from `{ type: "polygon", vertices }`) silently rendered as nothing. The contributor now switches on `ShapeType.ConvexPolygon` and traces the hull via `collider.vertices()`, closing the path, using the same per-body-type color + alpha scheme as the other shapes.
