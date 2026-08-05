---
"@yagejs/physics": patch
---

Collision events include an optional `contactImpulse` value in pixel-based impulse units, so games can score impacts without reading the body's post-solve velocity.
