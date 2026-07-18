---
"@yagejs/physics": patch
---

Snapshot restore order is now driven by a `restorePriority` static on each component class.

- `RigidBodyComponent` declares priority 10 and `ColliderComponent` 20, preserving the Transform → body → collider restore chain their `onAdd()` hooks require.
