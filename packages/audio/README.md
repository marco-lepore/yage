# @yage/audio

Sound loading, playback, and channel mixing for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yage/audio
```

Bundles [@pixi/sound](https://pixijs.io/sound/) - no separate install required.

## Usage

```ts
import { Engine } from "@yage/core";
import { AudioPlugin, sound } from "@yage/audio";

const engine = new Engine();
engine.use(new AudioPlugin({
  channels: {
    music: { volume: 0.7 },
    sfx: { volume: 1.0 },
  },
}));
```

Play sounds via the asset system or a `SoundComponent`:

```ts
const jumpSfx = sound("jump.mp3");
entity.add(new SoundComponent({ source: jumpSfx, channel: "sfx" }));
```

## What's in the box

- **AudioPlugin / AudioManager** - sound loading and playback
- **SoundComponent** - attach sounds to entities with auto-cleanup
- **Channels** - per-channel volume, mute, ducking
- **Spatial options** - 2D positional audio via pan

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
