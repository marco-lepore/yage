---
"@yagejs/particles": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `ParticleEmitterComponent` resolves `RandomKey` from the scene and threads it through every `resolveRange(...)` call site (spawn offsets, speed, angle, rotation, scale, lifetime). With a seeded inspector, particle bursts are bit-identical across replays.
