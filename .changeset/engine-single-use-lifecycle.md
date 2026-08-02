---
"@yagejs/core": patch
---

Make the engine lifecycle single-use instead of half-restartable.

- `Engine.start()` throws after `destroy()`, naming the alternatives: construct a new `Engine`, or reset the scene stack with `scenes.replace()` / `scenes.popAll()`. A second start used to run again on a torn-down instance, producing an engine whose scene manager ignored every push, whose systems ran in duplicate, and which threw `Service "..." is already registered.` as soon as any real plugin was installed.
- `Engine.destroy()` ignores repeat calls, so a host tearing down defensively no longer runs plugin `onDestroy` and system `onUnregister` twice.
- `Engine.use()` throws on a destroyed engine.
- `SceneManager` push, pop, replace and popAll warn in development builds when they are called on a destroyed engine, instead of resolving with no effect.
