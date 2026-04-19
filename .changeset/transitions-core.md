---
"@yagejs/core": minor
---

pr: 22
commit: 083b05bd9c9557ef32b9b82939e792983c4a5f9b
author: marco-lepore

Add scene transition system with push/pop/replace support, and rework the scene-manager cancellation story.

**Breaking:**

- `SceneManager.pop()` now returns `Promise<Scene | undefined>` (was synchronous).
- `SceneManager.clear()` is replaced by `SceneManager.popAll()`. `popAll` is async and queued — it waits for any in-flight transition and pending ops to drain, then pops every scene top-to-bottom. It does **not** cancel in-flight work (the previous `clear()` did). `Engine.destroy()` keeps a synchronous teardown path via an internal helper.

- New `SceneTransition` contract: `begin` / `tick` / `end` lifecycle with `SceneTransitionContext`.
- `SceneManager.push()`, `.pop()`, `.replace()` accept `{ transition }` option.
- `Scene.defaultTransition` — per-scene default used when no call-site transition is provided.
- `Scene.isTransitioning` / `SceneManager.isTransitioning` reflect active transition state.
- New events: `scene:transition:started`, `scene:transition:ended`. Both carry `{ kind, fromScene, toScene }` (scenes may be `undefined`).
- Concurrent scene ops queue via `_pendingChain`. Reentrant calls from scene lifecycle hooks throw with a message pointing to `queueMicrotask` / component `update()` as the right place to defer.
- `Plugin.onStart` is typed `void | Promise<void>` — `Engine.start()` already awaited it; the type now matches.
- `SceneManager` rejects non-finite transition durations (NaN/Infinity) at the orchestration layer instead of looping forever in `_tickTransition`.
- Core ships the contract + orchestration only; concrete transitions live in `@yagejs/renderer`.
