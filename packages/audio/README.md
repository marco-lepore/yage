# @yagejs/audio

Sound loading, playback, and channel mixing for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/audio
```

Uses native Web Audio for recorded and generated samples, scheduled playback,
channel mixing, and offline rendering.

## Usage

```ts
import { Engine } from "@yagejs/core";
import { AudioPlugin, sound } from "@yagejs/audio";

const engine = new Engine();
engine.use(
  new AudioPlugin({
    channels: {
      music: { volume: 0.7 },
      sfx: { volume: 1.0 },
    },
  }),
);
```

Play sounds via the asset system or a `SoundComponent`:

```ts yage-context="entity"
import { SoundComponent, sound } from "@yagejs/audio";

const jumpSfx = sound("jump.mp3");
entity.add(new SoundComponent({ alias: jumpSfx.path, channel: "sfx" }));
```

## What's in the box

- **AudioPlugin / AudioManager** - sound loading and playback
- **SoundComponent** - attach sounds to entities with auto-cleanup
- **Channels** - hierarchical volume, mute, pause, and stop
- **Audio-clock automation** - exact starts, releases, gain, pan, and playback rate
- **renderAudio / measureAudio** - offline graph rendering and sample statistics

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
