---
"@yagejs/physics": minor
---

Tiled collision-shape extraction and physics/debug correctness fixes, plus collider rotation support.

- `ColliderConfig` accepts an optional `rotation` (radians, relative to the body, about the collider's offset point), enabling tilted box/capsule colliders — e.g. ramps or angled hitboxes. Applied on both creation paths (`ColliderComponent`/`PhysicsWorld.createCollider` and `toRapierColliders`); for `axis: "x"` capsules it adds on top of the 90° axis rotation.
- `ColliderComponent.setSensor()` now updates `config.sensor` alongside the Rapier collider, so trigger/collision event routing, the sensor-mismatch warning, and serialized snapshots reflect the live sensor state.
- `PhysicsWorld.raycast()` normalizes the direction internally: any non-zero vector (e.g. `target.sub(origin)`) now yields correct range and hit distance. A zero-length direction throws.
