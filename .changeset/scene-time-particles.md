---
"@yagejs/particles": patch
---

`SceneTime`: per-scene arbitration for time effects — hitstop, slow motion, bullet time, freeze frames.

- `ParticleSystem` drives emitters under the per-entity `SceneTime.effectiveScaleForUpdates(entity)`, so freezes and slows affect particles and `excludeUpdates` keeps excluded entities' emitters at full speed.
