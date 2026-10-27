# @yagejs-addons/music

Adaptive music through YAGE audio: repeating patterns, arbitrary meter, swing,
parameter-controlled layers, quantized transitions and harmony-following cues.
Recorded and synthesized samples share the same playback path.

```sh
npm install @yagejs-addons/music @yagejs/core @yagejs/audio
```

Install `AudioPlugin` and preload or register the sources before attaching music:

```ts yage-context="entity"
import { MusicComponent } from "@yagejs-addons/music";
const music = entity.add(
  new MusicComponent({
    bpm: 108,
    meter: [3, 4],
    tracks: {
      pulse: { source: "kick", parameter: "intensity", notes: [{ beat: 0 }] },
    },
  }),
);
music.player.setParameter("intensity", 0.7);
```

The component stops on disable and disposes on destroy. Music follows audio time
independently of scene pause and time scale. Explicit player pause holds the beat
and cancels notes; resume continues with the next note. Browser unlock is handled
by `AudioPlugin`.

[Guide](https://yage.dev/addons/music/) · [API reference](docs/llms/music.md)
