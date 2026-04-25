# @yagejs/audio

## 0.3.0

### Minor Changes

- [#35](https://github.com/marco-lepore/yage/pull/35) [`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Audio unlock polish: expose browser-capability state and mute-on-blur behavior.
  - Add `AudioManager.isUnlocked()` / `onUnlock(cb)` / `offUnlock(cb)` for detecting when the `AudioContext` becomes running. `onUnlock` fires synchronously when already unlocked; otherwise once on the first user gesture that resumes the context. Returns a disposer.
  - Add `AudioManager.autoMuteOnBlur` (default `true`) — master-mutes via `IMediaContext.muted` when the tab hides and restores the prior state on return. Per-channel mutes and volumes are untouched. Runtime-mutable on `AudioManager` and on `AudioConfig` at plugin construction. Toggling to `false` while hidden unmutes immediately.
  - `AudioPlugin` installs the `visibilitychange` + gesture listeners and tears them down on `onDestroy`. Guarded for non-browser environments.
  - Pausing scenes on tab blur has moved to `SceneManager.autoPauseOnBlur` (see `@yagejs/core`) — audio no longer depends on the scene stack.

### Patch Changes

- [#38](https://github.com/marco-lepore/yage/pull/38) [`786d3c7`](https://github.com/marco-lepore/yage/commit/786d3c71b95fc17d3262a44100a77893b487c835) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix `autoMuteOnBlur` so it actually controls pause-on-blur behavior.

  The flag was a no-op in practice: `@pixi/sound`'s `WebAudioContext.autoPause` (default `true`) was suspending the entire `AudioContext` on `window.blur` independently, and our own `IMediaContext.muted` toggle never broadcast a `refresh()` to live sound instances. Result: audio paused regardless of the flag, and turning the flag off didn't keep audio playing.

  `AudioManager` now delegates pause-on-blur to pixi-sound's built-in `autoPause`, propagating the initial value at construction and writing through on the setter. When the flag is toggled while the window is currently unfocused, `paused` is reconciled immediately so the change takes effect now rather than waiting for the next blur event. The custom `visibilitychange` listener and snapshot/restore machinery are gone.

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/core@0.2.0
