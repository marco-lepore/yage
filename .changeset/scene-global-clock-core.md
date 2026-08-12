---
"@yagejs/core": patch
---

Scene-scoped and engine-global processes can run on the fixed timestep.

- `ProcessSystem.add(process, { clock: "fixed" })` and `ProcessSystem.addForScene(scene, process, { clock: "fixed" })` schedule a process on the fixed timestep. The default `"frame"` keeps it on rendered-frame time, so every existing call is unchanged. `makeSceneScopedQueue` and `makeGlobalScopedQueue` take the same option and forward it.
- `ProcessFixedUpdateSystem` drains both fixed pools. A scene pool advances inside the active-scene pass under the scene's effective scale, so it pauses and slows with its scene. The engine-global pool advances once per fixed step under the global time scale alone, matching the frame pass, where it is not gated by per-scene pause.
- Use the fixed clock for scene-level gameplay timing that belongs to no entity: a round timer, a wave spawner, an enrage window. On the frame clock those drift against the simulation they gate, and diverge from it under a stall or a catch-up burst.
- `ProcessSystem.cancel(tag?)`, `cancelForScene(scene, tag?)`, the scene-exit hook, and system teardown all cover both clocks.
- **Fix:** a scene-bound process that calls `cancelForScene` and then schedules new scene-bound work keeps that work. The drain used to discard the pool the callback had just created, so the new process never advanced and no cancel could reach it.
