---
"@yagejs/physics": patch
---

`RigidBodyComponent` gains allocation-free scalar velocity reads: `velocityX`, `velocityY`, `speed`, and `speedSquared`. Each reads a number straight from Rapier without allocating a `Vec2` — prefer these over `getVelocity()` on a per-frame read path. Reading both `velocityX` and `velocityY` calls into Rapier twice.
