# @yagejs-addons/synth

Procedural sound effects for YAGE: a sound is a plain parameter object,
rendered to samples and registered with `@yagejs/audio` under an alias, so it
plays through the engine's channels, mute, and blur auto-pause like a
preloaded file. No audio assets, no `AudioContext`. Root entry only — no
`/presenters` subpath.

## Install

```bash
npm install @yagejs-addons/synth @yagejs/core @yagejs/audio
```

Peers: `@yagejs/core` and `@yagejs/audio`, both required.

## Zero-config

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
audio.play("explosion", { channel: "sfx", volume: 0.8 });
audio.playRandom(synthVariantAliases("shoot", 4));
```

`SynthPlugin` renders every entry at install and calls `registerSound(alias,
buffer)`. Rendering needs no `AudioContext`, so it runs before the
first-gesture unlock. The plugin declares `dependencies: ["audio"]` — install
`AudioPlugin` too, or the engine throws naming it.

## `SynthPatch` (L1, one voice)

```ts
interface SynthPatch {
  wave?: "sine" | "square" | "sawtooth" | "triangle" | "noise"; // default "sine"
  frequency?: number; // Hz, default 440; ignored by "noise"
  glideTo?: number; // Hz at the end; exponential glide. Default: no glide
  duration?: number; // seconds, default 0.2, excludes `delay`
  attack?: number; // fade-in seconds, default 0.005
  curve?: number; // release steepness, default 3; 0 = linear fade
  noise?: number; // white noise mixed into the tone, 0-1, default 0
  filter?: SynthFilter;
  volume?: number; // peak before filtering, 0-1, default 0.3
  delay?: number; // silence before the voice starts, for layering
  seed?: number; // noise seed, default 1
  seamless?: boolean; // loop-clean render, default false
}
interface SynthFilter {
  type: "lowpass" | "highpass" | "bandpass";
  frequency: number; // cutoff (centre, for bandpass) in Hz at the start
  sweepTo?: number; // cutoff at the end; exponential sweep
  q?: number; // resonance, default 1
}
```

The envelope is an attack ramp then an exponential release filling the rest of
`duration`. A filter sweeps its cutoff across the whole sound. Output is mono,
clamped to [-1, 1].

## Layering and jingles

An array of patches is one sound; each voice carries its own `delay`:

```ts
import type { SynthSound } from "@yagejs-addons/synth";

const shotgun = [
  {
    wave: "sawtooth",
    frequency: 300,
    glideTo: 40,
    duration: 0.25,
    volume: 0.3,
  },
  {
    wave: "noise",
    duration: 0.3,
    volume: 0.3,
    filter: { type: "lowpass", frequency: 2000, sweepTo: 300 },
  },
  { wave: "square", frequency: 90, duration: 0.1, delay: 0.28, volume: 0.1 }, // the pump
] satisfies SynthSound;
```

A jingle bakes a note sequence into one buffer:

```ts
import type {
  SynthJingle as SynthJingleDefinition,
  SynthVoice,
} from "@yagejs-addons/synth";

interface SynthJingle {
  notes: readonly (
    | number
    | { frequency: number; duration?: number; volume?: number }
  )[];
  noteDuration?: number; // seconds each note sounds, default 0.16
  noteSpacing?: number; // seconds between note starts, default = noteDuration
  voice?: SynthVoice; // a SynthPatch without frequency/glideTo/duration/delay/seamless
}

const levelUp = {
  notes: [523, 659, 784, 1046],
  noteDuration: 0.18,
  noteSpacing: 0.12, // < noteDuration, so notes ring into each other
  voice: { wave: "triangle", volume: 0.26 },
} satisfies SynthJingleDefinition;
```

A note with `frequency: 0` is a rest.

`type SynthSound = SynthPatch | readonly SynthPatch[] | SynthJingle` — every
API here takes any of the three.

## Rendering (headless)

```ts
import type { SynthPatch, SynthJingle, SynthSound } from "@yagejs-addons/synth";

declare function renderSynthPatch(
  patch: SynthPatch,
  sampleRate?: number,
): Float32Array;
declare function renderSynthJingle(
  jingle: SynthJingle,
  sampleRate?: number,
): Float32Array;
declare function renderSynthSound(
  sound: SynthSound,
  sampleRate?: number,
): Float32Array;
declare function synthBuffer(
  sound: SynthSound,
  sampleRate?: number,
): AudioBuffer;
const SYNTH_SAMPLE_RATE = 44100;
```

Rendering is pure math — no WebAudio, no `Math.random`. The same sound and
sample rate always produce the same samples, so a test can assert on the array
(envelope shape, length, pitch direction). `seed` is what varies the noise.

`synthBuffer` is the escape hatch for sounds a game builds at runtime:

```ts
import { registerSound, unregisterSound } from "@yagejs/audio";
import { synthBuffer, synthPresets } from "@yagejs-addons/synth";
registerSound("boss-hit", synthBuffer(synthPresets.hit({ frequency: 180 })));
```

## Presets

`synthPresets.<name>(overrides?)` returns patch data. The override type
follows the preset's shape, so a field a preset cannot honour is a compile
error instead of a silent no-op:

```ts
import { synthPresets } from "@yagejs-addons/synth";

// One-voice and layered presets — SynthPatchOverrides (Partial<SynthPatch> & { gain? }).
// Patch fields land on the lead voice, keeping a stack's layers in relation.
synthPresets.shoot({ frequency: 900 }); // higher-pitched gun
synthPresets.explosion({ duration: 0.6, frequency: 200 }); // bigger boom
synthPresets.footstep({ surface: "wood" }); // "stone" | "wood" | "grass"

// Note-sequence presets (pickup, coin, victory, defeat) — SynthJingleOverrides
// (Partial<SynthVoice> & { gain?, noteDuration?, noteSpacing? }).
// Pitch comes from the notes, so frequency/glideTo/delay/seamless/duration don't compile.
synthPresets.victory({ noteDuration: 0.24, wave: "square" });

// dialogueBeeps is the exception: it GENERATES its notes, so it adds
// frequency (the base pitch), count, spread, and phraseSeed on top.
synthPresets.dialogueBeeps({ frequency: 220, count: 12, phraseSeed: 4 });

// `gain` is on every preset: it multiplies EVERY voice's volume, where
// `volume` sets one voice's peak. Use gain to quieten a whole layered sound.
synthPresets.shoot({ gain: 0.5 });
```

shoot, hit, explosion, hurt, pickup, coin, jump, land, dash, powerup,
footstep, uiClick, uiBlip, alarm, victory, defeat, roomTone, wind,
dialogueBeeps. Levels are tuned to sit together; scale with `gain` per game.

`dialogueBeeps` is loopable speech chatter — short blips around a base pitch
with syllable-like rests. Start it with `loop: true` when a line begins to
reveal, stop it when the line completes. Same `phraseSeed` = same phrase (the
voice's own `seed` still means its noise seed); give each character its own
`frequency`/`phraseSeed`:

```ts yage-context="component"
import { SynthPlugin, synthPresets } from "@yagejs-addons/synth";
import { AudioManagerKey } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);
new SynthPlugin({
  sounds: {
    "voice/guard": synthPresets.dialogueBeeps({
      frequency: 220,
      phraseSeed: 4,
    }),
  },
});
const talking = audio.play("voice/guard", { loop: true, channel: "voice" });
audio.stop(talking); // when the line finishes revealing
```

## Per-play variation

A baked buffer sounds identical every play. Two ways to break that up:

```ts yage-context="component"
import {
  SynthPlugin,
  synthPresets,
  synthVariantAliases,
  synthVariants,
  synthBuffer,
} from "@yagejs-addons/synth";
import { AudioManagerKey, registerSound } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);
// 1. Several takes, spread in pitch, picked at random per play.
new SynthPlugin({
  sounds: { shoot: { sound: synthPresets.shoot(), variants: 4, detune: 0.08 } },
});
audio.playRandom(synthVariantAliases("shoot", 4));

// 2. Jitter the playback rate at the call site (variants register only the
//    suffixed aliases, so play one of those).
audio.play("shoot.1", { speed: 0.95 + Math.random() * 0.1 });

// Building the takes yourself — register each one:
const takes = synthVariants("shoot", synthPresets.shoot(), 4, 0.08);
for (const { alias, sound } of takes) registerSound(alias, synthBuffer(sound));
```

`variants: n` registers `alias.1` … `alias.n` (nothing under the bare alias),
spread evenly across ±`detune` (default 0.06 = ±6%) with a different noise
seed each.

## Ambient loops

`seamless: true` drops the envelope and crossfades the tail into the head, so
the buffer loops without a click. The result is up to 50 ms shorter than
`duration`.

```ts yage-context="component"
import { SynthPlugin, synthPresets } from "@yagejs-addons/synth";
import { AudioManagerKey } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);
new SynthPlugin({
  sounds: { ambience: synthPresets.roomTone({ duration: 6 }) },
});
audio.play("ambience", { loop: true, channel: "music" });
```

`roomTone` is a low rumble bed; `wind` is a mid-band hiss with two gust
swells baked inside the loop (shortening its `duration` below ~5.6 s puts the
gusts past the loop point and the seam stops being clean).

## Save

Nothing to persist: the plugin re-registers every sound from its config on
boot, so a snapshot only ever holds the alias string. `onDestroy` unregisters
what it registered — `plugin.aliases` lists them.
