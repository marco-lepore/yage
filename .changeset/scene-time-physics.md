---
"@yagejs/physics": patch
---

`SceneTime`: per-scene arbitration for time effects — hitstop, slow motion, bullet time, freeze frames.

- `PhysicsSystem` steps each scene's world under `SceneTime.effectiveScale` (the persistent `scene.timeScale` composed with active freeze/slow-mo requests), so a `freezeFor` hitstop stops rigid bodies. `excludeUpdates` exclusions never apply to physics — the shared world has no per-body time.
