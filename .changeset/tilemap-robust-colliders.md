---
"@yagejs/tilemap": minor
"@yagejs/physics": minor
---

feat(tilemap): capsule/ellipse + concave-polygon collider support

**Tiled shape coverage.** `extractCollisionShapes` / `toPhysicsColliders`
now branch on the `ellipse` and `capsule` flags Tiled writes on object
instances; previously those silently fell through to the default
rectangle path and produced wrong AABB hitboxes. Ellipses become
`circle` colliders (with a dev-warning fallback when `width !== height`,
since Rapier has no real ellipse primitive); capsule objects become
`capsule` colliders oriented along the longer axis.

**Concave polygons via polyline.** Tiled polygons are authored as
outlines, not solid hulls, so `toPhysicsColliders` now emits them as
the new `shape: "polyline"` variant (chain of line segments). Unlike
`shape: "polygon"`, polylines preserve concave detail — at the cost of
being static-only (no inertia computed). The existing convex `polygon`
path now logs a dev warning when the input vertex list is concave, so
the silent convex-hull widening can't return.

**Breaking — `TilemapColliderConfig` types.** `extractCollisionShapes`
previously returned `RectColliderConfig | PolygonColliderConfig`; it
now also returns `CircleColliderConfig`, `CapsuleColliderConfig`, and
`PolylineColliderConfig` (and Tiled polygons map to `polyline` rather
than `polygon`). Code that exhaustively switches on the `type` field
needs new arms for `"circle"`, `"capsule"`, `"polyline"`, and should
treat the existing `"polygon"` case as covering only pre-converted
convex hull data.

**Breaking — `ColliderShape` adds `polyline` + `axis`.** The physics
`ColliderShape` discriminated union gains a `polyline` variant and the
`capsule` variant gains an optional `axis: "x" | "y"` field (default
`"y"`, matching previous behavior).
