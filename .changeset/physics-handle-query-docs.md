---
"@yagejs/physics": patch
---

The `PhysicsWorld.queryOverlapping` and `PhysicsWorld.contactBetween` documentation says both take internal collider handles, and points game code to `ColliderComponent.getOverlapping()` and `ColliderComponent.contactWith()`.
