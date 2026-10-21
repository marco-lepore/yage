# @yagejs-tools/audio

Render selected instruments and sound effects to WAV files during your build.
Games load the exported bank through `@yagejs/audio`; they do not need the
synthesis code for those sounds.

## Install and build

Requires Node.js 22 or newer.

```sh
npm install -D @yagejs-tools/audio
npm install @yagejs/core @yagejs/audio
yage-audio instruments
yage-audio build audio.config.json --out public/audio
yage-audio inspect public/audio/manifest.json
```

Create `audio.config.json`:

```json
{
  "version": 1,
  "sampleRate": 44100,
  "sounds": {
    "flute": {
      "sound": { "instrument": "flute", "seed": 17, "volume": 0.3 },
      "rootNote": 60
    },
    "kick": { "sound": { "instrument": "kick" } },
    "organ": { "sound": { "instrument": "organ" }, "rootNote": 60 }
  },
  "include": ["flute", "kick"]
}
```

`include` selects aliases. Omit it to build every declared sound. Declare
instruments used by gameplay cues as well as song tracks. The tool does not
analyze game source to discover references.

Each `sound` accepts a synth instrument, patch, array of patches, or jingle.
`rootNote` describes the rendered sample's MIDI pitch; it does not retune the
sample. Set the instrument's `frequency` when rendering a different root pitch.

The output contains mono PCM16 WAV files and `manifest.json`. Identical
resources share one file. Filenames contain a hash of the WAV bytes.
Loop points remain in the manifest, in seconds. Peak and RMS describe the
floating-point render before PCM quantization. Clipped or non-finite output
fails the build; lower the source volume to fix clipping.

Use a dedicated output directory. A successful build replaces its manifest
and removes obsolete WAV files listed by the previous build. Other files
remain. A rendering failure leaves the previous bank intact. Builds targeting
the same directory cannot write concurrently.

```sh
yage-audio build audio.config.json --out public/audio --watch
```

Watch mode rebuilds when the JSON file changes, including atomic file saves.
After a failed rebuild it reports the error and continues watching.
Reload the game to load a rebuilt bank.

`inspect` checks resource hashes, WAV metadata and missing files. It reports
alias count, unique files, WAV bytes and estimated decoded float32 bytes at
the source sample rate. Browser resampling and decoder overhead can change
actual memory use.

## Programmatic rendering

The root API renders in memory and works in Node or a browser preview.
The `/node` API writes files.

```ts
import { synthPresets } from "@yagejs-addons/synth/render";
import { buildAudioBank } from "@yagejs-tools/audio/node";

await buildAudioBank(
  {
    version: 1,
    sounds: { coin: { sound: synthPresets.coin() } },
  },
  { outDir: "public/audio" },
);
```

`renderAudioBank(config)` returns `{ manifest, files }`; each file has a
`file` name and `Uint8Array` data. `parseAudioBankConfig(unknown)` validates
and copies configuration. `listAudioInstruments()` returns the shared
instrument names.

Configuration accepts 1–128 sounds, integer sample rates from 8000 to 96000,
up to 32 patches per layered sound, and up to 256 jingle notes. Patches allow
0.001–30 seconds of duration and 0–30 seconds of delay. Jingles must fit
within 60 seconds. Unknown fields, invalid numbers and missing selected
aliases throw before files are written.

## Game playback

Use `soundBank(manifest, "/audio/")` from `@yagejs/audio`. Add
`Object.values(bank.sounds)` to the scene's preload list, then pass a handle
such as `bank.sounds.flute` to the music addon or audio manager.
Bank aliases are lookup keys, not global playback aliases.

The [audio build guide](https://yage.dev/tooling/audio/) shows complete game
setup, including asset ownership and music tuning.
