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

Engine integration through `/plugin` requires `@yagejs/core` and `@yagejs/audio`. The addon needs the
`registerSound` API from `@yagejs/audio`. No runtime deps, no `/presenters`
subpath — there is nothing to draw.

## 5-minute setup

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
    audio.play("explosion");
    audio.playRandom(synthVariantAliases("shoot", 4)); // a slightly different shot each time
  }
}
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
