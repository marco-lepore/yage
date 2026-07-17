---
"@yagejs/core": minor
---

`SceneTime`: per-scene arbitration for time effects — hitstop, slow motion, bullet time, freeze frames.

- New per-scene `SceneTime` service under the scene-scoped `SceneTimeKey`, registered by the engine for every scene. `scaleBy(factor, { for?, key?, excludeUpdates?, label? })` and `freezeFor(duration, { key?, label? })` return idempotent `TimeEffectHandle`s. Each `key` is a channel: within a channel the latest active request wins (older still-active entries apply again when it ends); across channels winners multiply; freeze is a ×0 factor. `scene.timeScale` stays the game's persistent knob and is never written by the service: `effectiveScale = scene.timeScale × channel winners`.
- Component updates and `ProcessComponent` ticks run under the per-entity `effectiveScaleForUpdates(entity)`, so `excludeUpdates` keeps chosen entities (e.g. a bullet-time caster) at full speed; `entity.timeScale` composes on top and is never written. Scene-pool processes run at the full `effectiveScale`.
- Request durations age on raw frame time at the start of each frame and hold while the scene is stack-paused; all requests release on scene exit, and effects are transient across save/load.
- `Scene.tryResolveScoped(key)` is public: read a scene-scoped service without engine-scope fallback.
- Inspector scene snapshots gain `effectiveTimeScale` and `frozen`.
