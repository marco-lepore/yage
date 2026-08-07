---
"@yagejs/physics": patch
---

Rounded box colliders and contact skins, so a walking body stops catching on terrain polyline junctions.

A box driven across a `polyline` terrain chain can stop moving at the junction between two segments. Rapier builds polyline contacts one segment at a time, and where a foot corner meets a vertex it picks a contact normal that opposes the walk direction. The contact regenerates every step, so the body never gets past the vertex.

- The box `ColliderShape` accepts `borderRadius`, which rounds the corners. The inner half-extents shrink by the radius, so the outer footprint and a resting body's height stay the same. The flat part of each face shrinks to `width - 2 * borderRadius`, so a body held up only by the last few pixels of a ledge slides off it. Shape casts and overlap queries use the rounded geometry. A radius that is not a finite number below half the shorter side throws when the collider is built.
- `ColliderConfig` accepts `contactSkin`, which holds a collider that many pixels away from whatever it touches. A resting body then sits that far above the ground, so prefer `borderRadius` when resting height matters. When both colliders in a pair set a skin, the gap is the sum of the two. Skins apply to contacts, not to queries.
- The debug overlay draws rounded box colliders at their outer footprint, with the corner radius visible.
