---
"@yagejs/physics": patch
---

Apply position and rotation written to a static body's Transform while its entity is inactive when the entity is activated. This keeps the collider aligned with dormant level placement and prewarmed pool setup. Active static bodies still move through `setPosition` and `setRotation` on the rigid body.
