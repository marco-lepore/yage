---
"@yagejs/core": minor
---

Omitting a required `setup()` field in `scene.spawn(Class, params)` or `entity.spawnChild(name, Class, params)` reports the missing field by name (`Property 'X' is missing`) instead of a confusing `SpawnOptions` error.
