---
"@yagejs/particles": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `ParticleEmitterComponent` hides its particle container while the entity is dormant. Emission stops because the emitter leaves `ParticleSystem`'s query, and the pooled particles are kept, so the effect picks up mid-flight on reactivation. A container you hid yourself stays hidden when the entity comes back.
