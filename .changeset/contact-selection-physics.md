---
"@yagejs/physics": patch
---

Collision events describe the deepest contact of the pair, so `contactNormal` reports the surface actually resisting the body.

A collider pair can produce several contact manifolds in one step: one per segment against a polyline chain, and more than one for a box resting on a corner. Rapier's manifold order depends on the approach direction, and `contactNormal`, `contactPoint`, and `penetrationDepth` were read from whichever manifold came first. A box walking onto the same tilemap ramp received the slope face normal from one side. From the other it received the normal of the chain's closing edge, which is coplanar with the floor and describes the ramp as level ground. Code that classifies ground by normal worked in one direction only.

Those three fields now come from the solver contact with the greatest overlap across every manifold of the pair. Reported values change only where the deepest contact was not in the manifold Rapier happened to report first. That needs a pair touching more than one surface at the same time, which is routine on polyline terrain and compound colliders. `penetrationDepth` is that deepest contact's overlap, still clamped to `>= 0`. `contactImpulse` and `contactImpulseVector` are unchanged: they still sum every manifold's impulse along its own normal.
