---
"@yagejs/physics": minor
---

Collision events are delivered after every physics step, rounded boxes weigh what their footprint covers, `setSensor` takes effect on existing contacts, and the physics constructors reject numbers they cannot simulate.

- Fixed: a scene running above `timeScale` 1 no longer loses collision and trigger events. Rapier's event queue was drained once per fixed tick after up to eight steps, and the queue discards undrained events at the start of each step, so only the last step's transitions survived: at 3 steps per tick a box landing on the ground reported nothing, and a bullet crossing a sensor band lost its exit. Events are now collected after every step, with that step's contact data, and delivered after that step. Handlers run with Transforms synced to the step that produced the contact, and a handler's `setVelocity` or `destroy` takes effect before the next step of the same tick.
- Fixed: a one-way platform no longer locks solid from below, or drops its rider, after a lost event. The platform's landed-rider set is maintained from the events, so the same loss left a rider registered after it had left (a later jump from below was blocked, and stayed blocked after the time scale returned to 1) or never registered at all (a rider fell through a `margin: 0` platform).
- Fixed: a box with `borderRadius` now weighs what its footprint covers. Rapier weighs a rounded box by its inner rectangle alone, so a 20×20 box with `borderRadius: 5` had a quarter of the mass of a plain one, and the same `applyImpulse` moved it four times as fast. The collider's density is now scaled so the mass is the rounded footprint's area at the configured `density`; angular inertia is the inner rectangle's scaled by the same ratio, an approximation the docs name. `setShape(shape, { recomputeMass: true })` reapplies the factor for the new shape.
- Fixed: `setShape` without `recomputeMass` keeps the body's mass in every case. A body that had not stepped yet, or was asleep, had its mass recomputed from density × the new shape at the next step.
- Fixed: `ColliderComponent.setSensor` now takes effect on the collider's existing contacts. Rapier does not apply a sensor-flag change to an awake body's existing pairs, so a solid box flipped to a sensor stayed resting on the ground, and a sensor flipped to solid fell through it. The Rapier collider is now recreated with the new flag: every pair it is in ends with a `stop`/`exit` at the next step and re-forms as the new kind, `getMass()` and the contact filter and every subscription are unchanged, and the collider handle changes. A same-value call does nothing. Dev builds warn when the flip leaves handlers of the silenced kind registered.
- Fixed: both contact filters run for every candidate pair. When the first filter Rapier consulted vetoed the pair, the other collider's filter was skipped, and which one came first was Rapier's handle order.
- Documented: while any collider has a contact filter (a `oneWay` platform counts), every step reads every collider's pose before stepping — about 0.8 ms per step at 2000 colliders.

**Breaking**, all pre-1.0:

- `new PhysicsPlugin(config)` and `new PhysicsWorld(config)` throw unless `pixelsPerMeter` is finite and above 0, and both gravity components are finite. A `pixelsPerMeter` of `0` produced a `NaN` world.
- `new RigidBodyComponent(config)` throws unless `linearDamping` and `angularDamping` are finite and at least 0, and `gravityScale` is finite. A negative damping grew a body's speed without bound.
- `new ColliderComponent(config)` throws unless `restitution`, `friction`, `density` and `contactSkin` are finite and at least 0, `oneWay.margin` and `oneWay.direction` are finite, and `oneWay.direction` is not the zero vector. A zero direction made the platform solid from every side.
- `PhysicsWorld.addJoint` throws unless every number in the config is finite and `length`, `restLength`, `stiffness` and `damping` are at least 0. A negative spring `damping` diverged.
- `PhysicsWorld.addJoint` throws when either entity is inactive. A joint added to a dormant body skipped the detach that disabling performs and survived into the entity's next life. For a pooled entity, add the joint in `onAcquire`.
- Every error names the input and the constraint.
- Collision handlers run more than once per fixed tick above `timeScale` 1.
- `getMass()` changes for every rounded box.
