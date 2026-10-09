---
"@yagejs/physics": minor
---

Add configurable character controllers with a complete dynamic platformer setup.

- Add `castShape(..., { solidFor: collider })` to find surfaces permitted by both colliders' contact filters, including one-way and drop-through rules. Filters use current poses and velocities with `dt: 0`.
- Add `contactWith(other, { solidOnly: true })` for geometry checks that respect collision groups, sensors, and both contact filters.
- Refresh only participating colliders during filtered shape casts instead of snapshotting the whole world for each cast.
