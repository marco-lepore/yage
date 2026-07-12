---
"@yagejs/physics": minor
---

World-query additions:

- `PhysicsWorld.queryShape(shape, position, { rotation?, filterGroups?, excludeEntity? })` — all entities with a collider overlapping a `ColliderShape` placed at a pixel position.
- `PhysicsWorld.queryRadius(center, radius, options?)` — circle sugar over `queryShape`.
- `PhysicsWorld.raycast` gains `excludeEntity`, skipping every collider of that entity — for rays that start inside the caster's own collider.
- `RigidBodyComponent.getMass()` — the mass Rapier derives from the attached colliders, for converting a desired velocity change into an impulse (`applyImpulse(dv.scale(body.getMass()))`).
