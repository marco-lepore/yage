---
"@yagejs/renderer": minor
---

Report fullscreen and screen orientation through one display contract that a host can supply.

- `Breaking:` `isFullscreen`, `orientation`, `requestFullscreen()` and `exitFullscreen()` are available from the renderer's `onStart` to `engine.destroy()`, like the other display members, because which application supplies the state is settled as the engine starts. A plugin that reads one in its own `onStart` is registered after `RendererPlugin`. Outside that span each one fails with `RendererPlugin.<member>: the display is only available from the renderer's onStart to engine.destroy(). A plugin that reads it in its own onStart must be registered after RendererPlugin.`
- A host adapter registers a `HostDisplay` under `HostDisplayKey` in its `install`, with a `fullscreen` part, an `orientation` part, or both. A part it leaves out comes from the page. `HostDisplay`, `HostFullscreen`, `HostOrientation` and `OrientationLock` are exported, and the key and the four types are also on the `@yagejs/renderer/api` entry, which loads no Pixi. `TestHostDisplay` is a fake with both parts, for tests.
- `fullscreenSupport` answers whether a request can change how the game is presented: `"unsupported"` on iPhone, in a frame from another origin without `allow="fullscreen"`, and in an app that already opens fullscreen. `orientationLockSupport`, `lockOrientation(lock)` and `unlockOrientation()` cover the orientation lock; a lock resolves with the orientation the host reports afterwards, which can differ from what was asked for when the device does not turn.
- `exitFullscreen()` resolves without asking the host when the game is not fullscreen, so another element's fullscreen is left alone.
- `screen:fullscreen` and `screen:orientation` are emitted once per change, and before the promise of a request the game made resolves. A request made while a request is pending shares its promise; one made while an exit is pending runs after the exit settles, and the reverse.
- Without a `resolution` setting the canvas follows the display's pixel ratio, so a window moved to a display with another ratio, and a browser zoom, resize the backing store. A configured `resolution` is held fixed.
