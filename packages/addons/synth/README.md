# @yagejs-addons/synth

Procedural sound effects for YAGE (`@yagejs-addons` scope, independently
versioned, NOT in the engine `fixed` group). A sound is a plain parameter
object; the addon renders it to samples, wraps them in an `AudioBuffer`, and
registers it with `@yagejs/audio` under an alias — so it plays through the
engine's channels, volumes, mute, and blur auto-pause exactly like a preloaded
file. No audio assets, no `AudioContext` of its own.

## Install

```bash
npm install @yagejs-addons/synth
npm install @yagejs/core @yagejs/audio # engine peers (single install, reused)
```

Peers: `@yagejs/core` and `@yagejs/audio`, both required. The addon needs the
`registerSound` API from `@yagejs/audio`. No runtime deps, no `/presenters`
subpath — there is nothing to draw.

## 5-minute setup

```ts yage-context="engine,component"
import { AudioPlugin, AudioManagerKey } from "@yagejs/audio";
import {
  SynthPlugin,
  synthPresets,
  synthVariantAliases,
} from "@yagejs-addons/synth";

engine.use(new AudioPlugin());
engine.use(
  new SynthPlugin({
    sounds: {
      explosion: synthPresets.explosion(),
      coin: synthPresets.coin(),
      shoot: { sound: synthPresets.shoot(), variants: 4 },
    },
  }),
);

// From a Component, Entity, or Scene:
const audio = this.use(AudioManagerKey);
audio.play("explosion");
audio.playRandom(synthVariantAliases("shoot", 4)); // a slightly different shot each time
```

Every alias is rendered once at install, before the browser's first-gesture
unlock. Playing is the normal `AudioManager` API — nothing new to learn.

## Tuning a sound

A preset returns plain data, so a different gun is a one-number edit:

```ts
import { synthPresets } from "@yagejs-addons/synth";

synthPresets.shoot({ frequency: 900, gain: 0.5 });
```

Overrides are typed by the preset's shape: patch fields for a one-voice or
layered sound (landing on the lead voice), the shared voice plus
`noteDuration`/`noteSpacing` for a note sequence like `victory`. `gain` scales
every voice of any preset at once.

Or write the patch yourself:

```ts
import { renderSynthPatch, synthBuffer } from "@yagejs-addons/synth";
import { registerSound } from "@yagejs/audio";

const zap = {
  wave: "square",
  frequency: 1200,
  glideTo: 200,
  duration: 0.09,
} as const;

registerSound("zap", synthBuffer(zap)); // outside the plugin config
const samples = renderSynthPatch(zap); // plain Float32Array — assert on it in a test
```

`renderSynthPatch` is pure math: no WebAudio, no `Math.random`, no engine import.
The same patch always renders the same samples, which is what makes a sound
unit-testable.

## What's in the box

- `SynthPatch` — one voice: oscillator (`sine`/`square`/`sawtooth`/`triangle`/`noise`),
  exponential pitch glide, noise mix, filter with an optional sweep, attack +
  exponential release, volume, delay, seed.
- Layering — an array of patches plays as one sound, each voice with its own
  `delay`.
- `SynthJingle` — a note sequence baked into one buffer (victory stings,
  two-note pickups).
- `synthPresets` — shoot, hit, explosion, hurt, pickup, coin, jump, land,
  dash, powerup, footstep (stone/wood/grass), uiClick, uiBlip, alarm, victory,
  defeat, roomTone, wind, dialogueBeeps.
- `synthVariants` / a `variants: n` config entry — several detuned takes of
  one sound, for `playRandom`.
- `seamless: true` — renders a loop-clean buffer for ambient beds, played with
  `loop: true`.

Full reference: `docs/llms/synth.md` in this package, and
[yage.dev/addons/synth](https://yage.dev/addons/synth/).

Buffers are rendered once and played back; per-play variation comes from
`variants` and the `speed` play option.
