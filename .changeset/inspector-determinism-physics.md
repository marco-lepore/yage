---
"@yagejs/physics": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `PhysicsWorld.snapshot()` returns a stable, sorted view of every rigid body (`entityId`, `type`, `position` and `linvel` in pixel units, `rotation` in radians, `angvel` in rad/s) plus the active contact pairs. Consumed by `Inspector.snapshot()` to record the full physics state per scene.
