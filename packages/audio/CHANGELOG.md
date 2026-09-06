# @yagejs/audio

## 0.11.0

### Minor Changes

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove automatic `SoundComponent` snapshot support and its serialized data
  type. Reconstruct playback from game-owned save state and registered asset
  aliases.

  Add `SoundComponent.alias` / `.channel` / `.loop` / `.volume` for reading the
  component's playback config back — also what the Inspector now reports for it.

- [#321](https://github.com/marco-lepore/yage/pull/321) [`d557809`](https://github.com/marco-lepore/yage/commit/d557809b68735d1acb639dd9c56e00dec16920d0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Let independent callers share and release one-shot audio safely.
  - Add `AudioManager.requestOnce()` and `SoundRequestHandle` for one releasable
    request on playback shared by alias and channel.
  - Keep `playOnce()` idempotent while request callbacks and force-stop cleanup
    follow the shared playback lifetime.

### Patch Changes

- [#319](https://github.com/marco-lepore/yage/pull/319) [`19c794e`](https://github.com/marco-lepore/yage/commit/19c794e7afa941539efcb4d23d8a9ec49a5233b6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Playback names an unknown alias, attributes a throwing `onEnd`, and accepts `sound()` handles.
  - `play`, `playOnce` and `playRandom` check the alias before playing and throw
    `AudioManager.play: no sound registered as "<alias>"`. The common failure —
    a typo, or playing before the asset preloaded — used to surface as
    `TypeError: Cannot read properties of undefined (reading 'play')`, with the
    alias nowhere in the message.
  - A throwing `onEnd` callback is recorded on
    `Inspector.getErrors().callbackErrors` as `"Audio onEnd callback"` and
    rethrown, instead of escaping unattributed into `@pixi/sound`'s emitter.
  - The three playback methods take the handle `sound()` returns as well as the
    alias string it registers: `audio.play(CoinSfx)` alongside
    `audio.play(CoinSfx.path)`. The `SoundRef` type is exported.

- [#338](https://github.com/marco-lepore/yage/pull/338) [`b73bc32`](https://github.com/marco-lepore/yage/commit/b73bc32e433f234871bec29ba4a9916194019200) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Import `@yagejs/audio` outside a browser. `AudioPlugin` loads `@pixi/sound` when it installs, so nothing in the package reaches `document` while it is being imported — a level check or a test run in Node can import a module that uses `sound()` or `SoundComponent`.

  `registerSound` and `unregisterSound` keep their signatures. A registration made before the plugin installs is applied when it does, so a call at module scope still works.

- Updated dependencies [[`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/core@0.11.0

## 0.10.4

### Patch Changes

- Updated dependencies [[`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f), [`753050b`](https://github.com/marco-lepore/yage/commit/753050b08270af8a73f694e27ca886613c1b57fa)]:
  - @yagejs/core@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372)]:
  - @yagejs/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1

## 0.10.0

### Minor Changes

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `SoundComponent` stops playback when the entity goes dormant. It does not restart on its own — call `play()` again if the sound should resume.
  - `SoundComponent`'s `playOnAdd` starts the sound once the entity is active. Adding the component to a dormant entity leaves it silent until the entity is activated; later deactivate/reactivate cycles do not replay it.

- [#223](https://github.com/marco-lepore/yage/pull/223) [`bfe6878`](https://github.com/marco-lepore/yage/commit/bfe687825124e8dce5f382b992021e08f6fc759f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `registerSound(alias, buffer)` and `unregisterSound(alias)` register a runtime-generated `AudioBuffer` under an alias, so it plays through the existing `AudioManager` channels, mute, and blur auto-pause exactly like a preloaded sound. This is the audio counterpart to `@yagejs/renderer`'s `registerTexture`, and lets code that synthesizes audio at runtime (procedural sound effects, generated jingles) register its output without going through a file asset.

### Patch Changes

- [#212](https://github.com/marco-lepore/yage/pull/212) [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da) Thanks [@marco-lepore](https://github.com/marco-lepore)! - An `AudioManager.onUnlock` callback that throws is now reported instead of being discarded silently.

  The callback is one-shot, so there's nothing to unsubscribe. It's logged with a full stack trace naming it and rethrown — see the `@yagejs/core` changeset — and recorded, readable via `engine.inspector.getErrors().callbackErrors`.

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5)]:
  - @yagejs/core@0.10.0

## 0.9.0

### Patch Changes

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - `SoundComponent` declares priority 50, keeping it inside the engine band so it restores before undeclared game components.

- Updated dependencies [[`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667)]:
  - @yagejs/core@0.9.0

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
