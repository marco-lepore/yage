---
"@yagejs/core": patch
---

Give the engine a single-use lifecycle with defined terminal states.

- `Engine.start()` throws after `destroy()`. A second start used to run the whole startup sequence again on a torn-down instance, which could not produce a working engine: the scene manager ignored every later push, so the stack stayed empty; each plugin's `registerSystems()` added a second copy of its systems next to the stale ones; and any plugin that registers a service threw `Service "..." is already registered.` The message names the alternatives — construct a new `Engine`, or reset the scene stack with `scenes.replace()` or `scenes.popAll()`.
- A `start()` that rejects is terminal too. Plugins installed before the failure hold services the container will not accept twice, so a retry cannot succeed. It used to return as though the engine were running while the loop was stopped. A later `start()` now throws and names `destroy()` as the way to release what did install.
- `destroy()` during an in-flight `start()` cancels the rest of startup. Teardown followed by a resuming `install()` used to start the game loop over a destroyed scene manager and unregistered systems.
- `destroy()` treats scene teardown, system unregistration and plugin `onDestroy` as independent stages, so a throw in one still lets the others run, and rethrows the first error once teardown finishes. A failing scene `onExit` no longer leaves plugins holding their resources.
- `destroy()` ignores repeat calls, so a host tearing down defensively no longer runs plugin `onDestroy` and system `onUnregister` twice.
- `Engine.use()` throws on a destroyed engine.
- `SceneManager` push, pop, replace and popAll warn in development builds when called on a destroyed engine, instead of doing nothing silently. Work already queued when teardown lands still resolves quietly.
