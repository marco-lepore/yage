---
"@yagejs/core": minor
"@yagejs/renderer": minor
---

Add scene transition system with push/pop/replace support.

**Breaking:** `SceneManager.pop()` now returns `Promise<Scene | undefined>` (was synchronous).

**`@yagejs/core`**

- New `SceneTransition` contract: `begin` / `tick` / `end` lifecycle with `SceneTransitionContext`.
- `SceneManager.push()`, `.pop()`, `.replace()` accept `{ transition }` option.
- `Scene.defaultTransition` — per-scene default used when no call-site transition is provided.
- `Scene.isTransitioning` — true while a scene transition is running.
- `SceneManager.isTransitioning` — true while any transition is active.
- New events: `scene:transition:started`, `scene:transition:ended`.
- Concurrent scene ops queue via `_pendingChain`; `clear()` cancels in-flight work.
- Core ships the contract + orchestration only; concrete transitions live in `@yagejs/renderer`.

**`@yagejs/renderer`**

- `fade({ duration?, color? })` — fade to solid color and back. Incoming scene hidden until mid-point; outgoing scene hidden at mid-point on pop.
- `flash({ duration?, color? })` — flash overlay with linear decay. Opaque at begin masks the scene swap.
- `crossFade({ duration? })` — cross-dissolve between scenes (both visible throughout).
- `getSceneContainer(ctx, scene)` — helper for custom transitions, resolves a scene's PIXI root container.
