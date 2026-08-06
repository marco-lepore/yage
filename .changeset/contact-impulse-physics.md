---
"@yagejs/physics": patch
---

Collision events include optional `contactImpulse` and `contactImpulseVector` values in pixel-based impulse units, so games can score impacts and derive push direction without reading the body's post-solve velocity.
