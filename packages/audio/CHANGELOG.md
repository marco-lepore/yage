# @yagejs/audio

## 0.8.0

### Minor Changes

- [#122](https://github.com/marco-lepore/yage/pull/122) [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add an `onEnd` callback to `AudioPlayOptions`. `audio.play(alias, { onEnd })` fires it once when the sound finishes on its own (its `end` event) — not on `stop()`, and never for a `loop`ing sound. The "tell me when this clip is done" seam, e.g. gating dialogue auto-advance on a voice clip without polling `SoundHandle.playing`.

### Patch Changes

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0)]:
  - @yagejs/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `AudioManager` accepts a `RandomService` so `playRandom(...)` is reproducible under inspector-driven seeds; `AudioPlugin` wires `globalRandom` by default.

### Patch Changes

- Updated dependencies [[`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805)]:
  - @yagejs/core@0.4.0

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
