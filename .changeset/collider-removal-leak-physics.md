---
"@yagejs/physics": patch
---

Removing just a `ColliderComponent` (`entity.remove(ColliderComponent)`) now frees its Rapier collider.

Previously the collider stayed attached to its body even though the component was gone — raycasts, overlap queries, and collision events kept hitting it. `PhysicsWorld.removeCollider()` frees the Rapier collider and clears its `colliderMap` entry; `ColliderComponent.onDestroy()` calls it. Destroying the whole entity, or removing the sibling `RigidBodyComponent`, still tears down every attached collider as before.
