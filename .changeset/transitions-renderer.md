---
"@yagejs/renderer": minor
---

pr: 22
commit: 083b05bd9c9557ef32b9b82939e792983c4a5f9b
author: marco-lepore

Add scene transition system with push/pop/replace support, and rework the scene-manager cancellation story.

- `fade({ duration?, color? })` — fade to solid color and back. Incoming scene hidden until mid-point; outgoing scene hidden at mid-point on pop.
- `flash({ duration?, color? })` — flash overlay with linear decay. Opaque at begin masks the scene swap.
- `crossFade({ duration? })` — cross-dissolve between scenes (both visible throughout). `end()` now leaves the outgoing container's alpha at 0 on pop/replace to avoid a one-frame flash between `end()` and the stack mutation.
- `getSceneContainer(ctx, scene)` — helper for custom transitions, resolves a scene's PIXI root container. All transition exports are also re-exported through `@yagejs/renderer`'s top-level barrel.
