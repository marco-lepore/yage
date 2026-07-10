---
"@yagejs/physics": patch
---

Tiled collision-shape extraction and physics/debug correctness fixes.

- `ColliderComponent.setSensor()` now updates `config.sensor` alongside the Rapier collider, so trigger/collision event routing, the sensor-mismatch warning, and serialized snapshots reflect the live sensor state.
- `PhysicsWorld.raycast()` normalizes the direction internally: any non-zero vector (e.g. `target.sub(origin)`) now yields correct range and hit distance. A zero-length direction throws.
