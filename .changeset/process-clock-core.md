---
"@yagejs/core": patch
---

Entity processes can run on the fixed timestep as well as on rendered-frame time.

- `ProcessComponent.run(process, { clock: "fixed" })` and `pc.slot({ clock: "fixed", ... })` schedule the process or slot on the fixed timestep. The default `"frame"` ticks on rendered-frame time. The new `ProcessClock` type (`"frame" | "fixed"`) is exported.
- The new `ProcessFixedUpdateSystem`, registered by the engine at `Phase.FixedUpdate` priority 500, advances fixed-clock processes once per fixed step — after the physics step, before component `fixedUpdate(dt)` calls. Pause gating and global/scene/entity time scaling match the frame pass.
- A slot's clock is set when the slot is created; `start()`/`restart()` overrides cannot change it. The engine-global and scene-bound pools (`ProcessSystem.add`/`addForScene`) stay on the frame clock.
