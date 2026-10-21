# @yagejs-addons/synth

Procedural sound effects for YAGE: a sound is a plain parameter object,
rendered to samples and registered with `@yagejs/audio` under an alias, so it
plays through the engine's channels, mute, and blur auto-pause like a
preloaded file. No audio assets, no `AudioContext`. The `/render` entry provides pure rendering and `/worker` serves a worker.
There is no `/presenters` subpath.

## Install

```bash
npm install @yagejs-addons/synth @yagejs/core @yagejs/audio
```

Engine integration through `/plugin` requires `@yagejs/core` and `@yagejs/audio`.

## Zero-config

```ts yage-context="engine"
import { AudioPlugin, AudioManagerKey } from "@yagejs/audio";
import { Component } from "@yagejs/core";
import { synthPresets, synthVariantAliases } from "@yagejs-addons/synth";
import { SynthPlugin } from "@yagejs-addons/synth/plugin";

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
class Cannon extends Component {
  fire(): void {
    const audio = this.use(AudioManagerKey);
    audio.play("explosion", { channel: "sfx", volume: 0.8 });
    audio.playRandom(synthVariantAliases("shoot", 4));
  }
}
```

`SynthPlugin` renders every entry at install and calls `registerSound(alias,
buffer)`. Rendering needs no `AudioContext`, so it runs before the
first-gesture unlock. The plugin declares `dependencies: ["audio"]` — install
`AudioPlugin` too, or the engine throws naming it.

## `SynthPatch` (L1, one voice)

```ts
import type {
  SynthFilter as BaseSynthFilter,
  SynthPatch as BaseSynthPatch,
} from "@yagejs-addons/synth";

interface SynthPatch extends BaseSynthPatch {
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
interface SynthFilter extends BaseSynthFilter {
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
import type { SynthPatch } from "@yagejs-addons/synth";

const shotgun: SynthPatch[] = [
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
];
```

A jingle bakes a note sequence into one buffer:

```ts
import type {
  SynthJingle as BaseSynthJingle,
  SynthVoice,
} from "@yagejs-addons/synth";

interface SynthJingle extends BaseSynthJingle {
  notes: readonly (
    | number
    | { frequency: number; duration?: number; volume?: number }
  )[];
  noteDuration?: number; // seconds each note sounds, default 0.16
  noteSpacing?: number; // seconds between note starts, default = noteDuration
  voice?: SynthVoice; // a SynthPatch without frequency/glideTo/duration/delay/seamless
}

const levelUp: SynthJingle = {
  notes: [523, 659, 784, 1046],
  noteDuration: 0.18,
  noteSpacing: 0.12, // < noteDuration, so notes ring into each other
  voice: { wave: "triangle", volume: 0.26 },
};
```

A note with `frequency: 0` is a rest.

`type SynthSound = SynthPatch | readonly SynthPatch[] | SynthJingle | SynthInstrument`.

## Rendering (headless)

```ts
import type {
  SynthJingle,
  SynthPatch,
  SynthSound,
  SynthInstrumentBank,
} from "@yagejs-addons/synth";

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
  instruments?: SynthInstrumentBank,
): Float32Array;
declare function synthBuffer(
  sound: SynthSound,
  sampleRate?: number,
  instruments?: SynthInstrumentBank,
): AudioBuffer;
declare const SYNTH_SAMPLE_RATE = 44100;
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

```ts yage-context="engine"
import { synthPresets } from "@yagejs-addons/synth";
import { SynthPlugin } from "@yagejs-addons/synth/plugin";

engine.use(
  new SynthPlugin({
    sounds: {
      "voice/guard": synthPresets.dialogueBeeps({
        frequency: 220,
        phraseSeed: 4,
      }),
    },
  }),
);
```

After initialization, play the configured sound from a component method:

```ts yage-context="component"
import { AudioManagerKey } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);

const talking = audio.play("voice/guard", { loop: true, channel: "voice" });
audio.stop(talking); // when the line finishes revealing
```

## Per-play variation

A baked buffer sounds identical every play. Two ways to break that up:

```ts yage-context="engine"
import {
  synthBuffer,
  synthPresets,
  synthVariantAliases,
  synthVariants,
} from "@yagejs-addons/synth";
import { SynthPlugin } from "@yagejs-addons/synth/plugin";

// 1. Several takes, spread in pitch, picked at random per play.
engine.use(
  new SynthPlugin({
    sounds: {
      shoot: { sound: synthPresets.shoot(), variants: 4, detune: 0.08 },
    },
  }),
);
```

After initialization, play the configured sound from a component method:

```ts yage-context="component"
import { AudioManagerKey } from "@yagejs/audio";
import { synthVariantAliases } from "@yagejs-addons/synth";
import { RandomKey } from "@yagejs/core";

const audio = this.use(AudioManagerKey);
const random = this.use(RandomKey);

audio.playRandom(synthVariantAliases("shoot", 4));

// 2. Jitter the playback rate at the call site with the scene's generator
//    (RandomKey, not Math.random). Variants register only the suffixed
//    aliases, so play one of those.
audio.play("shoot.1", { speed: random.range(0.95, 1.05) });
```

```ts
import { registerSound } from "@yagejs/audio";
import { synthBuffer, synthPresets, synthVariants } from "@yagejs-addons/synth";

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

```ts yage-context="engine"
import { synthPresets } from "@yagejs-addons/synth";
import { SynthPlugin } from "@yagejs-addons/synth/plugin";

engine.use(
  new SynthPlugin({
    sounds: { ambience: synthPresets.roomTone({ duration: 6 }) },
  }),
);
```

After initialization, play the configured sound from a component method:

```ts yage-context="component"
import { AudioManagerKey } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);

audio.play("ambience", { loop: true, channel: "music" });
```

`roomTone` is a low rumble bed; `wind` is a mid-band hiss with two gust
swells baked inside the loop (shortening its `duration` below ~5.6 s puts the
gusts past the loop point and the seam stops being clean).

## Save

Nothing to persist: the plugin re-registers every sound from its config on
boot, so a snapshot only ever holds the alias string. `onDestroy` unregisters
what it registered — `plugin.aliases` lists them.

## Instruments and sustain regions

Import each instrument from `@yagejs-addons/synth/instruments/<name>`.
Each definition provides `sound(options?)` for a portable descriptor and
`render(options?, sampleRate?)` for samples with optional sustain points.
Pass the definitions used by your sounds to `SynthPlugin.instruments`:

```ts yage-context="engine"
import { AudioPlugin } from "@yagejs/audio";
import { SynthPlugin } from "@yagejs-addons/synth/plugin";
import { electricPiano } from "@yagejs-addons/synth/instruments/electricPiano";
import { bass } from "@yagejs-addons/synth/instruments/bass";
import { flute } from "@yagejs-addons/synth/instruments/flute";

engine.use(new AudioPlugin());
engine.use(
  new SynthPlugin({
    instruments: { electricPiano, bass, flute },
    sounds: {
      keys: electricPiano.sound(),
      bass: bass.sound({ frequency: 130.812783 }),
      lead: flute.sound({ seed: 42, volume: 0.15 }),
    },
  }),
);
```

Available names: banjo, bass, uprightBass, guzheng, marimba, kalimba,
glassBell, vibraphone, bell, electricPiano, pad, flute, clarinet, organ,
kick, brushTap, brushSwish, shaker, rim, clap, ride, cymbal, tom,
pinkNoise and brownNoise. `synthInstruments` from
`@yagejs-addons/synth/instruments` contains every definition when the
application needs the complete catalogue.

Options are `frequency` (default 261.625565 Hz), `seed` (default 1), and
`volume` (default 0.3). Drums ignore pitch. Rendering accepts sample rates
8000–96000 Hz, frequency 20–min(4000, sampleRate/4) Hz, volume 0–1, and
uint32 seeds.

```ts
import { flute } from "@yagejs-addons/synth/instruments/flute";
const sample = flute.render({ frequency: 440, seed: 17 }, 44100);
console.log(sample.samples.length, sample.loopStart, sample.loopEnd);
```

`renderSynthSample(sound, sampleRate?, instruments?)` renders a descriptor,
patch, patch array or jingle. The instrument set defaults to empty; an
instrument absent from that set throws naming the instrument. The same
third argument applies to `renderSynthInstrument`, `renderSynthSound` and
`synthBuffer`. Patches and jingles need no instrument set.

`sampleBuffer(sample)` creates an AudioBuffer. Pad, flute, clarinet, organ
and noise samples include sustain regions in seconds, registered by
SynthPlugin. With manual registration, pass those points to `registerSound`.
`renderSynthSound` and `synthBuffer` omit loop metadata; use
`renderSynthSample` when you need it. Play sustained instruments with
`loop: true` and stop them with `handle.release(at, duration)`.

## Worker rendering and readiness

For a large bank, provide a dedicated module worker. Import the same
instrument definitions in the worker and the plugin so main-thread fallback
can render every sound. An empty set supports patches and jingles only:

```ts
import { serveSynthWorker } from "@yagejs-addons/synth/worker";
import { flute } from "@yagejs-addons/synth/instruments/flute";
serveSynthWorker({ flute });
```

Pass `worker: new Worker(new URL("./synth-worker.ts", import.meta.url),
{ type: "module" })` to SynthPlugin in a bundler that supports module workers.
The plugin owns and terminates that worker. Engine startup awaits the complete
bank; play sources only after startup. With no worker, it renders on the main
thread using the same seeded functions.

`plugin.getDiagnostics()` reports state, mode, completed/total, fallbackReason
and failure. Worker transport errors or inactivity (default `workerTimeout:
5000` ms) fall back to main-thread rendering with an explicit reason. Invalid
sound data rejects installation. Destruction cancels pending work and removes
registered aliases. A disposed plugin cannot be installed again.

## Build-time rendering and portable sound data

Use `@yagejs-tools/audio` to export selected sounds as WAV files before the
game starts. The game can then load the bank through `@yagejs/audio` without
importing the synth catalogue. See [audio builds](https://yage.dev/tooling/audio/).

The `/render` entry works in Node and browser previews without an AudioContext:

```ts
import {
  parseSynthSound,
  renderSynthSample,
} from "@yagejs-addons/synth/render";
import { flute } from "@yagejs-addons/synth/instruments/flute";
const instruments = { flute };
const descriptor = parseSynthSound(
  { instrument: "flute", seed: 17 },
  instruments,
);
const sample = renderSynthSample(descriptor, 44100, instruments);
console.log(sample.samples.length, sample.loopStart, sample.loopEnd);
```

`parseSynthSound(unknown, instruments?)` validates and copies portable instrument, patch,
layer and jingle data. Instrument names must be present in the supplied set.
Unknown fields throw. Portable data limits duration
and delay to 30 seconds each, layers to 32 patches, and jingles to 256 notes
within 60 seconds. Volumes are 0–1 and seeds are uint32.

Flute and clarinet combine authored harmonic spectra with breath noise and
pitch motion. Organ combines harmonic oscillators. All three include a
sustain region and use the package's MIT license.
