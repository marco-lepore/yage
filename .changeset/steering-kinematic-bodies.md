---
"@yagejs-addons/steering": patch
---

Steer kinematic bodies correctly.

- `PhysicsSteeringAgent` now branches on the sibling body's type. On a kinematic body it integrates the `Transform` in `fixedUpdate` — kinematic bodies ignore `setVelocity`/`applyImpulse`, so previously the agent silently never moved them. Passing `drive` with a kinematic body throws, and mounting on a static body throws.
- `SteeringAgent` gains `tick: "update" | "fixedUpdate"` (default `"update"`), choosing which hook steers.
- Docs: the previous recommendation of a "kinematic velocity-based" body is corrected — the engine has no such body type, and velocity drive requires a dynamic body.
