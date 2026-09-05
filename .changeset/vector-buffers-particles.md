---
"@yagejs/particles": patch
---

Add caller-owned vector buffers and coordinate reads without Vec2 construction.

- Reuse Transform coordinate buffers when positioning emitter containers and spawning particles.
