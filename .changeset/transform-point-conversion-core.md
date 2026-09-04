---
"@yagejs/core": patch
---

Add `Transform.localToWorld(point)`, the inverse of `Transform.worldToLocal(point)`: it scales the point by `worldScale`, turns it by `worldRotation`, and offsets it by `worldPosition` — the same composition a child transform goes through — so an offset authored beside the entity, such as a muzzle or a hardpoint, follows it however the parent chain turns or scales it. It takes a `Vec2Like` and returns a `Vec2`.
