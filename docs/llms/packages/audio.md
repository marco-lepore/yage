# @yagejs/audio

Depends on `@yagejs/core`, `@pixi/sound`. Channel-based audio playback.

## Setup

```ts
import { AudioPlugin } from "@yagejs/audio";

engine.use(new AudioPlugin({
  channels: {
    sfx: { volume: 1 },
    music: { volume: 0.7 },
  },
  autoMuteOnBlur: true, // default: true — master-mute while tab hidden
}));
```

## Unlock & Tab Mute

Browsers suspend the `AudioContext` until the user interacts with the page; `@pixi/sound` already resumes it on the first pointer/touch gesture, so "play on click" works out of the box. That means **music scheduled on page-load stays silent until first click** — not a bug, but surprising. Use `isUnlocked` / `onUnlock` to schedule autoplay that survives the delay:

```ts
const audio = this.use(AudioManagerKey);

audio.isUnlocked();              // boolean — AudioContext.state === "running"
audio.onUnlock(() => audio.play("music/title", { channel: "music", loop: true }));
audio.offUnlock(cb);             // remove a pending listener (disposer from onUnlock also works)

audio.autoMuteOnBlur = true;     // default true — snapshots + restores IMediaContext.muted across blur/focus
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

// Play
const handle = audio.play(CoinSfx.path, { channel: "sfx", volume: 1, loop: false, speed: 1 });
audio.playOnce(alias, opts);            // skip if already playing via playOnce
audio.playRandom([a, b, c], opts);      // random pick

// SoundHandle
handle.playing;   // boolean
handle.volume;    // get/set
handle.speed;     // get/set
handle.paused;    // get/set
handle.muted;     // get/set
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

## SoundComponent

Entity-bound audio. Auto-stops on entity destroy.

```ts
import { SoundComponent } from "@yagejs/audio";

entity.add(new SoundComponent({
  alias: CoinSfx.path,
  channel: "sfx",
  playOnAdd: true,
  loop: false,
  volume: 1,
}));

// Control
const sc = entity.get(SoundComponent);
sc.play();    // returns SoundHandle
sc.stop();
sc.handle;    // SoundHandle | null
```
