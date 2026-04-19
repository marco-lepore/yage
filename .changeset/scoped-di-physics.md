---
"@yagejs/physics": minor
---

pr: 20
commit: 6143e0346820dd74d78b1d345ac4ebc5e4294769
author: marco-lepore

Add scene-scoped DI and generic scene hooks.

- New `PhysicsWorldKey` (scene-scoped) is now exported. Components should use `this.use(PhysicsWorldKey)` instead of `this.use(PhysicsWorldManagerKey).getOrCreateWorld(this.scene)`.
