---
"@yagejs/physics": patch
---

One-way platforms and per-pair contact filters.

- `ColliderConfig.oneWay` makes a collider solid from the side its `direction` faces (default `{ x: 0, y: -1 }`, up) and passable from every other side. `direction` is in the platform body's local frame; `margin` (default 4px) is how deep a body may already overlap the face and still land. A body already inside the platform is let out instead of snapped to the surface. Round-trips through save/load.
- `ColliderComponent.dropThrough(seconds)` lets one body fall through one-way platforms for a window of simulated time — other bodies on the same platform stay supported. `isDroppingThrough` reports the window state. Callable before the component is added.
- `ColliderComponent.setContactFilter(filter | null)` is the primitive underneath: a `ContactFilter` decides per candidate pair, per step, whether the pair is solid. The reused `ContactCandidate` argument carries both sides' start-of-step positions, rotations, and body velocities plus the other side's `Entity`/`ColliderComponent`; no contact normal exists at filter time. When both colliders have filters, the pair is solid only if both agree. A throwing filter is reported through the error boundary and the pair stays solid for that step.
- Rapier's physics hooks are passed to the step only while at least one filter is registered, so worlds without filters step exactly as before. Rapier's CCD honors the filtering, including drop-through; fast bodies should enable `ccd: true` as usual.
- `PhysicsWorld.elapsed` exposes total simulated time in seconds.
- The debug overlay draws one-way colliders in orange with an arrow toward the solid face.
