---
"create-yage": patch
---

pr: 20
commit: 6143e0346820dd74d78b1d345ac4ebc5e4294769
author: marco-lepore

Adopt scene-scoped DI.

- Template `PlayerController` uses `PhysicsWorldKey` instead of `PhysicsWorldManagerKey.getOrCreateWorld(scene)`.
- Template `main.ts` awaits `engine.scenes.push(...)` to match the async scene-manager API.
