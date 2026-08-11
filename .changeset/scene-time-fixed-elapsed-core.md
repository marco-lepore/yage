---
"@yagejs/core": patch
---

Scene time offers a fixed-timestep elapsed reading alongside the rendered-frame one.

- `SceneTime.fixedElapsed` reports simulation seconds accrued one fixed step at a time (`fixedTimestep × effectiveScale`), composed exactly like `SceneTime.elapsed` and held by the same stack pause, `timeScale = 0`, and freeze requests. Stamp and compare gameplay times against it from fixed-step code, where `elapsed` moves with the rendered frame and makes the same window span a different number of simulation steps run to run.
- The engine accrues it once per fixed step for each active scene before the `FixedUpdate` phase runs, so a fixed-step reader sees the step it is inside and the value agrees with the physics world that stepped under the same scale. A frame that clamps at `maxFixedStepsPerFrame` contributes only the steps that ran, so `fixedElapsed` falls behind `elapsed` while the loop clamps.
