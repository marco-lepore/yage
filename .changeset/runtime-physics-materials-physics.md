---
"@yagejs/physics": minor
---

Add runtime controls for body damping, collider materials, and collider shape placement.

- Add `setLinearDamping` and `setAngularDamping` to `RigidBodyComponent`.
- Add `setRestitution` and `setFriction` to `ColliderComponent`, applying each value to every compound part.
- Let `ColliderComponent.setShape` change a selected part's body-local offset with its shape in one validated call.
- Reject non-finite scaled collider geometry before initial attachment or a runtime `Transform` scale change reaches Rapier.
