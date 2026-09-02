---
"@yagejs/particles": minor
---

Remove particle-emitter snapshot methods and serialized config types. Particle
simulation and renderer resources are runtime state; persist only the domain
values needed to reconstruct an emitter.
