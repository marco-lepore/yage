---
"@yagejs/core": minor
"@yagejs/renderer": minor
"@yagejs/save": patch
---

Add scene transition system with push/pop/replace support, and rework the scene-manager cancellation story.

**Breaking:**

- `SceneManager.pop()` now returns `Promise<Scene | undefined>` (was synchronous).
- `SceneManager.clear()` is replaced by `SceneManager.popAll()`. `popAll` is async and queued — it waits for any in-flight transition and pending ops to drain, then pops every scene top-to-bottom. It does **not** cancel in-flight work (the previous `clear()` did). `Engine.destroy()` keeps a synchronous teardown path via an internal helper.

**`@yagejs/core`**

- New `SceneTransition` contract: `begin` / `tick` / `end` lifecycle with `SceneTransitionContext`.
- `SceneManager.push()`, `.pop()`, `.replace()` accept `{ transition }` option.
- `Scene.defaultTransition` — per-scene default used when no call-site transition is provided.
- `Scene.isTransitioning` / `SceneManager.isTransitioning` reflect active transition state.
- New events: `scene:transition:started`, `scene:transition:ended`. Both carry `{ kind, fromScene, toScene }` (scenes may be `undefined`).
- Concurrent scene ops queue via `_pendingChain`. Reentrant calls from scene lifecycle hooks throw with a message pointing to `queueMicrotask` / component `update()` as the right place to defer.
- `Plugin.onStart` is typed `void | Promise<void>` — `Engine.start()` already awaited it; the type now matches.
- `SceneManager` rejects non-finite transition durations (NaN/Infinity) at the orchestration layer instead of looping forever in `_tickTransition`.
- Core ships the contract + orchestration only; concrete transitions live in `@yagejs/renderer`.

**`@yagejs/renderer`**

- `fade({ duration?, color? })` — fade to solid color and back. Incoming scene hidden until mid-point; outgoing scene hidden at mid-point on pop.
- `flash({ duration?, color? })` — flash overlay with linear decay. Opaque at begin masks the scene swap.
- `crossFade({ duration? })` — cross-dissolve between scenes (both visible throughout). `end()` now leaves the outgoing container's alpha at 0 on pop/replace to avoid a one-frame flash between `end()` and the stack mutation.
- `getSceneContainer(ctx, scene)` — helper for custom transitions, resolves a scene's PIXI root container. All transition exports are also re-exported through `@yagejs/renderer`'s top-level barrel.

**`@yagejs/save`**

- `SaveService.loadSnapshot` awaits `sceneManager.popAll()` before restoring scenes, matching the new async API.
