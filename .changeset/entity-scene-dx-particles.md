---
"@yagejs/particles": patch
---

Migrate `ParticleSystem`'s defensive `entity.scene` null check to the new `entity.tryScene` introduced in `@yagejs/core`. No behavior change.
