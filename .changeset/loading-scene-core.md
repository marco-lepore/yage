---
"@yagejs/core": minor
---

Add `LoadingScene` — orchestration base class for loading screens.

- Preloads `target.preload` through the engine's `AssetManager`, emits `scene:loading:progress` and `scene:loading:done` on the event bus, and hands off to `target` via `scenes.replace` (optionally through a `SceneTransition`).
- Loading is kicked off by calling `this.startLoading()` — usually at the end of `onEnter` after spawning the loading UI. Deferring the call gates the start of the load on a title screen, intro animation, or "press any key to start" without any extra flag.
- `target` accepts a `Scene` instance or a factory `() => Scene`.
- `minDuration` (ms) keeps the loading scene on screen long enough to avoid flicker on cached loads.
- `autoContinue` (default `true`) can be set `false` to gate the handoff behind a manual `scene.continue()` call — enables "press any key to continue" flows.
- `progress` getter (0 → 1) for ad-hoc reads; primary consumption is via the new bus events.
- `onLoadError` hook for retry / error UIs. The scene stays mounted on failure; call `startLoading()` from the hook to retry, or leave the default (error logged via the engine logger, scene remains in a failed state).
- Extends `EngineEvents` with `scene:loading:progress` and `scene:loading:done` event keys.

LoadingScene does not render; spawn an entity in `onEnter` (the default is `LoadingSceneProgressBar` in `@yagejs/ui`) or any component that subscribes to the loading events.
