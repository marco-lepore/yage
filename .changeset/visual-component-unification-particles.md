---
"@yagejs/particles": minor
---

Unify the five visual components' options, delete the raw-texture escape
hatches, and stop leaking raw `pixi.js` types from public signatures.

- `ParticleEmitterComponent.container` is now typed as
  `@yagejs/renderer`'s `ParticleContainer` alias instead of a raw
  `pixi.js` import, and `ParticlePool.acquire()`/`release()` use the new
  `Particle` alias. Type-only change — the values are still the real Pixi
  objects.
