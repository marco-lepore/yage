---
"@yagejs/physics": patch
---

Add `ColliderComponent.contactWith` and `PhysicsWorld.contactBetween`: the closest points between two colliders at their current poses, for sensors and for pairs that never collided.

- `collider.contactWith(other, { selfShapeIndex?, otherShapeIndex?, prediction? })` returns a `ColliderContact` (`point` on this collider's surface, `otherPoint` on the other's, a unit `normal` from this collider toward the other, and the `distance` between the points in pixels, negative by the penetration depth when overlapping) or `undefined` when the pair is further apart than `prediction` (default 0) or either component has no live collider. Passing a trigger or collision event's shape indices measures the pair that fired it; without them a compound collider reports the closest pair among its parts. Trigger events carry no contact data because a sensor overlap has no solver contact; this query fills that gap.
- `world.contactBetween(handle, otherHandle, prediction?)` is the same query by Rapier handle. A negative or non-finite `prediction` throws.
