---
"@yagejs/core": minor
---

Make class-based entity spawning safe for addon-authored setup hooks.

- Add `entityClassHasTrait()` for checking inherited traits before spawning an entity class.
- Remove a class-spawned entity immediately when its `setup()` method throws, then rethrow the original error.
