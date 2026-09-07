---
"@yagejs/physics": minor
---

Add `stopAtPenetration` to `PhysicsWorld.castShape` options. Set it to `false` to check movement out of an initial wall or floor overlap while still detecting obstacles farther along the route. The default remains `true`, so existing casts continue to report initial overlaps at distance zero.
