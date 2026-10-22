---
"@yagejs/physics": patch
---

Filter world queries and contact checks by what a given collider would collide with.

- `raycast`, `castShape`, `queryShape`, and `queryRadius` accept `solidFor: collider`. A query reports only colliders the source collider would collide with at their current poses: not its own entity, not sensors, with compatible collision groups, and accepted by both contact filters, including one-way and drop-through rules.
- `contactWith(other, { solidOnly: true })` measures a pair only when the two colliders would collide.
- The shared `QueryOptions` type describes the filters all four world queries accept. Combining `solidFor` with `sensors: "only"` throws, because `solidFor` skips every sensor.
- `RigidBodyComponent.rotationsLocked` reports whether the body's rotation is locked by `fixedRotation` or `lockRotations()`.
- `MAX_PHYSICS_STEPS_PER_UPDATE` (8) is the most physics steps a scene runs per fixed update. Above that time scale, physics advances more slowly than the scene clock.
