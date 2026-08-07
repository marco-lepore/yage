---
"@yagejs/core": patch
---

A buffered-press window can count on a scene's simulation time as well as on the raw input clock.

- `SceneTime.elapsed` reports the scene's simulation seconds: raw frame time scaled by `effectiveScale`, accrued only while the scene is active. A stack-paused scene, a `timeScale` of 0, and an active freeze all hold it. It starts at 0 each time the scene is entered and is not saved.
