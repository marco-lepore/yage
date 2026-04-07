# @yage/audio

Depends on `@yage/core`, `@pixi/sound`. Channel-based audio playback.

## Setup

```ts
import { AudioPlugin } from "@yage/audio";

engine.use(new AudioPlugin({
  channels: {
    sfx: { volume: 1 },
    music: { volume: 0.7 },
  },
}));
```

Or `createGame({ audio: true })`.

## Asset Factory

```ts
import { sound } from "@yage/audio";

const CoinSfx = sound("assets/coin.wav");
// Add to scene preload: readonly preload = [CoinSfx];
```

## AudioManager

```ts
import { AudioManagerKey } from "@yage/audio";

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
import { SoundComponent } from "@yage/audio";

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
