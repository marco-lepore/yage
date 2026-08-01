---
"@yagejs/physics": patch
---

Three additions for per-body motion control, all additive:

- `RigidBodyComponent.setGravityScale(scale)` and the `gravityScale` getter — change one body's gravity multiplier at runtime. `1` is scene gravity, `0` removes it, higher falls faster. Variable jump height and fast-fall need this per body, without moving scene gravity for everything else.
- `ColliderComponent.setShape(shape, options?)` — replace a collider's shape in place. The Rapier collider, its body attachment, and every `onCollision`/`onTrigger` subscription survive, so a crouch or slide can shrink the collider and restore it without removing and re-adding the component. The body keeps its mass, so a crouching character takes the same `applyImpulse` knockback as a standing one; pass `{ recomputeMass: true }` when the new shape means more or less matter. Growing does not push anything out of the way, so check clearance with `PhysicsWorld.queryShape` before restoring the larger size.
- `PhysicsWorld.castShape(shape, origin, direction, maxDistance, options?)` — sweep a shape along a direction and get the first hit, as the swept counterpart to `queryShape`. Returns the same `{ entity, point, normal, distance }` result as `raycast`, where `distance` is how far the shape travelled. A shape already overlapping something at `origin` reports `distance: 0`. Direction is normalized internally; a zero-length direction throws.

Both setters are callable before the component is added; the value applies when the Rapier body or collider is created.
