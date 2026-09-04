# @yagejs/audio

Depends on `@yagejs/core`, `@pixi/sound`. Channel-based audio playback.

## Setup

```ts
import { AudioPlugin } from "@yagejs/audio";

engine.use(
  new AudioPlugin({
    channels: {
      sfx: { volume: 1 },
      music: { volume: 0.7 },
    },
    autoMuteOnBlur: true, // default: true — pause AudioContext on window blur
  }),
);
```

## Unlock & Tab Mute

Browsers suspend the `AudioContext` until the user interacts with the page. `@pixi/sound` already resumes it on the first pointer/touch gesture, so "play on click" works without extra setup. That means **music scheduled on page-load stays silent until first click** — not a bug, but surprising. Use `isUnlocked` / `onUnlock` to schedule autoplay that survives the delay:

```ts
const audio = this.use(AudioManagerKey);

audio.isUnlocked(); // boolean — AudioContext.state === "running"
audio.onUnlock(() =>
  audio.play("music/title", { channel: "music", loop: true }),
);
audio.offUnlock(cb); // remove a pending listener (disposer from onUnlock also works)

audio.autoMuteOnBlur = true; // default true — toggles @pixi/sound's WebAudioContext.autoPause (suspends context on window blur)
```

- `onUnlock(cb)` fires synchronously if already unlocked; otherwise once on the first gesture that resumes the context. Returns a disposer.
- `isUnlocked()` is never flipped by `autoMuteOnBlur` — it is strictly the browser capability check.
- Pausing scenes on tab blur is a scene-lifecycle concern, not an audio one: use `SceneManager.autoPauseOnBlur` (see `core.md`).

## Asset Factory

```ts
import { sound } from "@yagejs/audio";

const CoinSfx = sound("assets/coin.wav");
// Add to scene preload: readonly preload = [CoinSfx];
```

## AudioManager

```ts
import { AudioManagerKey } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);

// Play — takes a `sound()` handle or the alias string it registers
const handle = audio.play(CoinSfx, {
  channel: "sfx",
  volume: 1,
  loop: false,
  speed: 1,
});
audio.playOnce(CoinSfx, opts); // skips playback if already playing
const request = audio.requestOnce(CoinSfx, opts); // one releasable request for shared playback
audio.playRandom([CoinSfx, "assets/step.wav"], opts); // random pick

request.active; // boolean
request.release(); // release only this request

// SoundHandle
handle.playing; // boolean
handle.volume; // get/set
handle.speed; // get/set
handle.paused; // get/set
handle.muted; // get/set
handle.stop();

// Stop
audio.stop(handle);
audio.stopChannel("sfx");
audio.stopAll();

// Channel volume
audio.setChannelVolume("music", 0.5);
audio.getChannelVolume("music");

// Mute
audio.muteChannel("sfx");
audio.unmuteChannel("sfx");
audio.muteAll();
audio.unmuteAll();

// Pause
audio.pauseChannel("music");
audio.resumeChannel("music");
```

`play`, `playOnce`, `requestOnce`, and `playRandom` throw naming the alias when no sound is registered under it — a typo, or playback before the asset finished preloading. Preload it with `sound(path)` or register it with `registerSound(alias, buffer)`.

`playOnce` and `requestOnce` share one playback for each alias and channel.
`playOnce` holds one implicit owner; repeated calls return the same
`SoundHandle` without adding owners. Each `requestOnce` call returns an
independent `SoundRequestHandle`. Releasing a request stops the shared sound
only when no requests or `playOnce` owner remain. Natural completion makes all
request handles inactive and calls `onEnd` for each request that was still
active. A released request receives no callback. Stopping the shared
`SoundHandle`, its channel, or all audio makes every request inactive.

## Runtime sounds

**`registerSound(alias, buffer)` / `unregisterSound(alias)`** — register a runtime-generated `AudioBuffer` under an alias so it resolves and plays exactly like a preloaded sound, through the same `AudioManager` channels, mute, and blur auto-pause. Audio analogue of the renderer's `registerTexture(key, texture)`.

```ts
import { registerSound, AudioManagerKey } from "@yagejs/audio";

const buffer = synthesizeShot(); // any code that produces an AudioBuffer
registerSound("shoot", buffer);

const audio = this.use(AudioManagerKey);
audio.play("shoot");
```

Semantics:

- Runtime buffers are not persisted by YAGE. If game-owned save data contains
  an alias, re-register the buffer under that alias before reconstructing
  playback.
- Registered aliases are engine-global and live until `unregisterSound(alias)`.
- `unregisterSound` is a no-op for aliases it never registered. An `AudioBuffer` has no destroy step, so unlike `unregisterTexture` there is nothing to release beyond the alias itself.
- Re-registering an alias replaces the entry.
- Registering an alias already used by a loaded sound asset (or any entry the API didn't create) throws — shadowing a loaded asset would let that asset's unload destroy the registered sound.

## SoundComponent

Entity-bound audio. Auto-stops on entity destroy.

```ts
import { SoundComponent } from "@yagejs/audio";

entity.add(
  new SoundComponent({
    alias: CoinSfx.path,
    channel: "sfx",
    playOnAdd: true,
    loop: false,
    volume: 1,
  }),
);

// Control
const sc = entity.get(SoundComponent);
sc.play(); // returns SoundHandle
sc.stop();
sc.handle; // SoundHandle | null

// Read the config back (also what the Inspector reports for the component)
sc.alias;
sc.channel;
sc.loop;
sc.volume;
```
