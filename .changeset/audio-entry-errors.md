---
"@yagejs/audio": patch
---

Playback names an unknown alias, attributes a throwing `onEnd`, and accepts `sound()` handles.

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
