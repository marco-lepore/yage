---
"@yagejs-addons/steering": minor
---

Steering runs on the fixed step.

- **Breaking:** `SteeringAgentOptions.tick` and the `SteeringAgent.update(dt)` hook are removed. `SteeringAgent` steers from `fixedUpdate` only, so Transform integration, a velocity-drive write, and an impulse-drive correction each run once per fixed step. Code that drives an agent by hand calls `fixedUpdate(dt)`. Steering turns world state into a desired velocity, which is simulation input — physics and the gameplay code that reads the result already run on that clock.
- An agent reads the pose the physics step simulated rather than the blend the frame draws, so `arrive` radii, `followPath`'s `waypointRadius`, the flock ranges, and the `avoidColliders` ray origin all measure against simulated positions. Under a scene time scale below 1 some fixed ticks run with no physics step, and the `Transform` then holds the blend the last frame drew.
- `faceHeading` writes the Transform rotation, which a dynamic body's simulated rotation owns. Pass `syncRotation: false` on the `RigidBodyComponent` to give the agent rotation.
- A bodyless agent's drawn position changes once per fixed step, and nothing in the engine interpolates a `Transform` that no rigid body drives. One way to draw that motion on the frame clock is to record the commanded velocity in `apply` and integrate it in your own `update`.
- `SteeringApplyContext.dt` carries fixed-step seconds. `stop()` still passes `dt: 0`.
