---
"@yagejs/physics": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `RigidBodyComponent` and `ColliderComponent` switch their Rapier body and collider out of the simulation on `onDisable` and back in on `onEnable`. The allocations are kept, which is what makes reuse cheaper than respawning.
- Disabling a body clears its linear and angular velocity and its queued forces and torques, so it cannot resume a motion from a previous life. Re-enabling snaps interpolation to the body's current pose.
- `PhysicsSystem` and `PhysicsInterpolationSystem` skip dormant entities. Collision and trigger handlers are not called for one, and `getOverlapping` does not report one. Both guards matter because disabling a collider leaves its queued events and its narrow-phase pairs in place until the next step.
- Known Rapier behavior: a collider disabled and re-enabled while it still overlaps something gets no fresh collision-start event.
- A rigid body or collider added to a dormant entity starts out of the simulation, so it neither drifts under gravity nor reports contacts until the entity is activated.
