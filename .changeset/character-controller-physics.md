---
"@yagejs/physics": patch
---

Filter world queries and contact checks by what a given collider would collide with.

- `raycast`, `castShape`, `queryShape`, and `queryRadius` accept `solidFor: collider`. A query reports only colliders the source collider would collide with at their current poses: not its own entity, not sensors, with compatible collision groups, and accepted by both contact filters, including one-way and drop-through rules.
- `contactWith(other, { solidOnly: true })` measures a pair only when the two colliders would collide.
- The shared `QueryOptions` type describes the filters all four world queries accept. Combining `solidFor` with `sensors: "only"` throws, because `solidFor` skips every sensor.
- `RigidBodyComponent.rotationsLocked` reports whether the body's rotation is locked by `fixedRotation` or `lockRotations()`.
- `MAX_PHYSICS_STEPS_PER_UPDATE` (8) is the most physics steps a scene runs per fixed update. Above that time scale, physics advances more slowly than the scene clock.
- A kinematic body moved through its Transform travels to the new position at a steady speed at every time scale. Each physics step covers its share of the scene time not yet simulated, so above time scale 1 the movement is spread over all the steps of an update. When that time is not a whole number of steps, the body ends the update short of the position and continues in the next. Its Transform keeps the position the game wrote. Bodies resting on a moving kinematic body stay in contact at any time scale.
- `PhysicsWorld.nextUpdateTime` is the scene time, in seconds, that the scene's next fixed update has to simulate. A kinematic body's speed during that update is the distance to its new position divided by this time. It is 0 while the scene's time scale is 0.
- A kinematic body's velocity reads (`getVelocity`, `getVelocityInto`, `velocityX`, `velocityY`, `speed`, `speedSquared`, `getAngularVelocity`) report its travel over the last physics step. They keep that value on updates that run no step and through world queries made between steps. A teleport sets them to zero until the next step. Contact filter candidates and `PhysicsWorld.snapshot()` report the same values.
- A world query made between steps leaves every body's velocity unchanged, including a body riding a moving platform.
