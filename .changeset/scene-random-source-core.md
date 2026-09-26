---
"@yagejs/core": minor
---

Move per-scene randomness out of the Inspector into `SceneRandomSource`.

- `engine.sceneRandom` (also `SceneRandomSourceKey`) creates each scene's `RandomKey` RNG and owns the seed it starts from. `setSeed(seed)` reseeds every scene on the stack and every scene that enters later. Game code that pins a seed as part of play calls it directly.
- `inspector.setSeed(seed)` keeps working and calls `engine.sceneRandom.setSeed(seed)`.
- Breaking: `Inspector.createSceneRandom()` is removed. Use `engine.sceneRandom.createSceneRandom()`.
- Breaking: `setSeed` throws for a `NaN` or infinite seed, naming the value. It used to convert one silently to `0`.
- The internal `Inspector.setDefaultSceneSeed()` hook is removed. `DebugPlugin` installs `deterministicSeed` through `SceneRandomSource.setDefaultSeed()`.
