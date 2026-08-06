---
"@yagejs/physics": patch
---

Add `PhysicsWorld.addJoint`, connecting two rigid bodies with a spring or rope joint. The returned handle reports `attached` and detaches the joint via `remove()`, which is safe to call more than once. Joints detach automatically when a jointed entity is disabled or destroyed.
