---
"@yagejs/core": patch
---

Scene time offers a fixed-timestep elapsed reading alongside the rendered-frame one.

- `SceneTime.fixedElapsed` reports simulation seconds accrued one fixed step at a time (`fixedTimestep × effectiveScale`), composed exactly like `SceneTime.elapsed` and held by the same stack pause, `timeScale = 0`, and freeze requests. Stamp and compare gameplay times against it from fixed-step code, where `elapsed` moves with the rendered frame and makes the same window span a different number of simulation steps run to run.
- The engine accrues it once per fixed step for each active scene before the `FixedUpdate` phase runs, so a fixed-step reader sees the step it is inside. Only time the loop has converted into fixed steps is counted, so the reading trails `elapsed` by whatever is still in the loop's accumulator — under one fixed step most frames, more right after a frame that hit `maxFixedStepsPerFrame`.
- The increment uses the whole-scene `effectiveScale`, so it does not follow `entity.timeScale` or an `excludeUpdates` exclusion. Time an entity that runs at its own rate against its `ProcessComponent` instead.
