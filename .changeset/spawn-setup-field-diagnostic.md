---
"@yagejs/core": minor
---

Omitting a required `setup()` field in `scene.spawn(Class, params)` or `entity.spawnChild(name, Class, params)` reports the missing field by name (`Property 'X' is missing`) instead of a confusing `SpawnOptions` error.

The class form derives its params slot from the `setup` parameter itself: a required parameter makes the params argument required (`spawn(Class)` is a type error even when the parameter object's fields are all optional), and the params slot only accepts the setup param type — a `SpawnOptions`-shaped literal is no longer silently accepted where params belong.
