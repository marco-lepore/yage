---
"@yagejs/input": patch
---

The hold-duration queries can count on a scene's simulation time instead of the raw input clock.

- `getHoldDuration`, `isHeldFor`, `isJustHeldFor`, `isJustTapped`, `isJustReleasedAfter`, and `getReleaseDuration` take an optional `{ clock }` — the `SceneTime` of a scene on the stack, the same clock `consumeBufferedPress` already accepts. The duration then stops while the scene is stack-paused or frozen and follows the scene's effective time scale, so a charge meter and the physics it charges in measure time the same way. Omit the option and the query counts on the raw input clock as before, so no existing call site changes.
- Each clock keeps its own readings: one press can be a tap on the scene clock and a long press on the raw one, and `isJustHeldFor` carries a separate threshold baseline per clock and fires once on each. A hold already running when a scene is entered counts from zero on that scene's clock, and its release reports only the part measured there.
- Passing a clock the plugin never registered throws from every query in the family, including `isJustTapped` and `isJustReleasedAfter` outside a release window. The message names the query the caller wrote.
- `isJustTapped` and `isJustReleasedAfter` are false when the clock holds no length for the release, instead of treating the missing length as 0 seconds. This corrects a long press being reported as a tap after it was released while its group was disabled, or before the scene whose clock is being read was entered. `getReleaseDuration` still answers 0 in that case.
