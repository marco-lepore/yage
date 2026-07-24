---
"@yagejs/particles": minor
---

Emitters spawn particles centred on their entity's world position.

- `burst(count)` without coordinates spawns at the entity's `Transform.worldPosition` instead of the world origin. `burst` now takes either no position or both coordinates — `burst(count, x)` is a type error rather than an x with an implied y of 0.
- Continuous emission reads `Transform.worldPosition` rather than the local `position`, so an emitter parented to another entity — a muzzle flash on a gun, a thruster on a ship — emits where it is drawn.
- Particles are anchored at their middle, so one is drawn centred on its spawn point and `rotationSpeed` turns it about its own centre. This changes how existing emitters look: a particle used to hang down and to the right of the spawn point by half its size, and spin about its top-left corner. It applies to your own textures as well as to built-in shapes.
- `ParticleEmitterComponent` requires a `Transform` on the same entity, and warns once on the first `emit()` or `burst()` if there is none. `ParticleSystem` queries for both, so such an emitter never emits and never ages the particles a `burst` already spawned.
