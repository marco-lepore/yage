---
"@yagejs/physics": minor
---

Populate `CollisionEvent.contactNormal` and `contactPoint`, and add a new `penetrationDepth` field, on started non-sensor collisions. `contactNormal` is a unit `Vec2` pointing from this entity toward the other entity; `contactPoint` is a representative world-pixel contact point; `penetrationDepth` is the overlap depth in world pixels, clamped to `>= 0`. All three stay `undefined` on stopped collisions, trigger events, and started events where Rapier has no contact manifold yet.
