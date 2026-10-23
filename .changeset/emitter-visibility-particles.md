---
"@yagejs/particles": minor
---

`ParticleEmitterComponent` has `visible` and `alpha`, and hands out its Pixi object under one name, `renderObject`.

- `visible` hides or shows every particle. A hidden emitter keeps emitting and ageing its particles. A value written while the entity is dormant is remembered and applied on activation, and a hide is kept across a `setActive(false)` / `setActive(true)` cycle.
- `alpha` sets the whole emitter's opacity, multiplied into the opacity each particle gets from the `alpha`, `alphaFadeIn` and `alphaFadeOut` options. It throws on a non-finite value.
- Breaking: `ParticleEmitterComponent.container` is removed. Hide or fade an emitter through its `visible` and `alpha`.
