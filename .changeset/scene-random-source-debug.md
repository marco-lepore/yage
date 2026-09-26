---
"@yagejs/debug": patch
---

`DebugPlugin` installs `deterministicSeed` on `engine.sceneRandom` instead of on the Inspector. A `NaN` or infinite `deterministicSeed` now throws from the `DebugPlugin` constructor, naming the value. It used to seed every scene with `0`.
