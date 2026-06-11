---
"@yagejs/core": minor
"@yagejs/particles": minor
"@yagejs/save": minor
---

Add a per-entity `timeScale` multiplier (closes #92).

- `Entity.timeScale` (default `1`) scales the delta time the engine feeds an
  entity's components: `dt * scene.timeScale * entity.timeScale`. It composes
  on top of the scene's `timeScale`, so `0` freezes a single entity while the
  scene keeps running and `2` runs it at double speed.
- Applies to component `update()` / `fixedUpdate()`
  (`ComponentUpdateSystem`), the entity's `ProcessComponent` tween tick
  (`ProcessSystem` — scene-scoped processes stay scene-only), and the entity's
  particle emitters (`ParticleSystem`).
- Physics is deliberately carved out: a scene shares one Rapier world stepped
  once per (scene-scaled) fixed tick, so a rigid body cannot be individually
  time-scaled. Use `scene.timeScale`, a kinematic body, or manual velocity
  scaling for per-body time control.
- `entity.timeScale` is captured and restored by the save snapshot (omitted
  from the snapshot when left at the default to keep saves compact).
