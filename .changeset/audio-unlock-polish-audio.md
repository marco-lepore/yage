---
"@yagejs/audio": minor
---

Audio unlock polish: expose browser-capability state and mute-on-blur behavior.

- Add `AudioManager.isUnlocked()` / `onUnlock(cb)` / `offUnlock(cb)` for detecting when the `AudioContext` becomes running. `onUnlock` fires synchronously when already unlocked; otherwise once on the first user gesture that resumes the context. Returns a disposer.
- Add `AudioManager.autoMuteOnBlur` (default `true`) — master-mutes via `IMediaContext.muted` when the tab hides and restores the prior state on return. Per-channel mutes and volumes are untouched. Runtime-mutable on `AudioManager` and on `AudioConfig` at plugin construction. Toggling to `false` while hidden unmutes immediately.
- `AudioPlugin` installs the `visibilitychange` + gesture listeners and tears them down on `onDestroy`. Guarded for non-browser environments.
- Pausing scenes on tab blur has moved to `SceneManager.autoPauseOnBlur` (see `@yagejs/core`) — audio no longer depends on the scene stack.
