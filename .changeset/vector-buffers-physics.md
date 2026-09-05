---
"@yagejs/physics": patch
---

Add caller-owned vector buffers and coordinate reads without Vec2 construction.

- Add `getVelocityInto` and `getPositionInto` and preserve the other velocity coordinate with one Rapier read in scalar setters.
- Store interpolation positions as numbers and synchronize Transform poses and collider scales without constructing vectors.
