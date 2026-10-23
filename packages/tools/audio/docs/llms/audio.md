# @yagejs-tools/audio

Build-time rendering of selected synth sounds to mono PCM16 WAV files and
`SoundBankManifest` metadata. Node 22+. The tool is a development dependency.
The game uses `@yagejs/audio` asset handles and needs no synth import for an
exported bank.

## CLI

```sh
yage-audio instruments [--instruments src/audio/instruments.ts]
yage-audio build audio.config.json --out public/audio
yage-audio build audio.config.json --out public/audio --watch
yage-audio build audio.config.json --out public/audio --instruments src/audio/instruments.ts
yage-audio inspect public/audio/manifest.json
```

`--instruments <module>` imports a game's instrument module through the
project's Vite, with the Vite config in the working directory, so aliases,
extensionless imports and multi-file modules resolve as in the game. `vite` (^8) is an optional peer dependency; without it
the flag throws an error naming the fix. The module runs in Node: no browser
globals at import time. Every export that is a `SynthInstrumentDefinition`
joins the 25 built-ins; an export with a built-in's name replaces it. Two
distinct definitions with one name, or no definition, throw. Import failures
throw `AudioBank: failed to import <module>: <cause>`.

Config is JSON with `version: 1`, optional `sampleRate` (default 44100),
`sounds: Record<string, { sound: SynthSound; rootNote?: number }>`, and optional
`include: string[]`. Omitted include exports all declared aliases. Includes must
be non-empty, unique, and present in sounds. Declare gameplay cue instruments
explicitly; game source is not scanned.

`SynthSound` is an instrument descriptor, patch, array of patches, or jingle.
An instrument descriptor is `{ instrument, frequency?, seed?, volume? }`.
Use `yage-audio instruments` for names, including flute, clarinet and organ.
Default frequency is middle C, seed 1, volume 0.3. The manifest's `rootNote` is
derived from a pitched instrument's frequency (`69 + 12 * log2(Hz / 440)`, so
523.25 Hz is 72); drums and noise get none, except the tom (43). A config
`rootNote` overrides it,
for example for a patch. Aliases rendering identical audio share one file and
must agree on rootNote, or the build throws. It is metadata and does not change
rendering.

## API

```ts
import { renderAudioBank } from "@yagejs-tools/audio";
const bank = await renderAudioBank({
  version: 1,
  sounds: { flute: { sound: { instrument: "flute", seed: 17 } } },
});
console.log(
  bank.manifest,
  bank.files.map((file) => file.file),
);
```

- `parseAudioBankConfig(unknown, instruments?): AudioBankConfig`: validate and
  copy. Instrument names must belong to `instruments` (default: the 25
  built-ins, `synthInstruments`).
- `renderAudioBank(unknown, { instruments? }?): Promise<RenderedAudioBank>`: no
  filesystem or AudioContext. Returns `{ manifest, files: { file, data:
Uint8Array }[] }`. `instruments` is a `SynthInstrumentBank`; pass
  `{ ...synthInstruments, ...custom }` to keep the built-ins.
- `listAudioInstruments(instruments?: SynthInstrumentBank): readonly string[]`:
  sorted names of the given bank, default the 25 built-ins.
- `/node`: `buildAudioBank(unknown, { outDir, instruments? }): Promise<ExportedSoundBankManifest>`.
  `ExportedSoundBankManifest` is `SoundBankManifest` with every build
  diagnostic present; rebuilds and `inspect` reject a manifest missing one.
- `/node`: `inspectAudioBank(manifestPath): Promise<AudioBankInspection>`.
  Validates resource hashes and WAV headers, returns manifest, aliases, files,
  wavBytes and decodedBytes. Decoded estimate uses mono float32 at source rate;
  resampling and decoder overhead are excluded.

## Output and validation

- WAV filenames use SHA-256 of encoded bytes. Identical renders share a file.
  Identical descriptors render once per build; persistent render caching is
  not provided.
- Manifest version 1: sampleRate and sounds keyed by alias. Each exported entry
  has file, frames, bytes, samplePeak, rms, clippedSamples, rootNote for pitched
  sounds, and paired loopStart/loopEnd in seconds for sustained ones. The
  runtime reads only file, the loop pair and rootNote.
- Peak and RMS describe the render before PCM16 quantization. Any clipping
  (absolute sample >= 1) or non-finite sample rejects export.
- Config bounds: 1–128 sounds, integer sampleRate 8000–96000, 1–32 layered
  patches, 1–256 jingle notes. Patch duration 0.001–30 seconds, delay 0–30.
  Jingles must fit in 60 seconds. Instrument frequency 20–min(4000, rate/4).
  Volumes 0–1, seed uint32. Unknown fields throw.
- All rendering completes before writes. The manifest is replaced after WAV
  writes; obsolete hash-named files from the prior manifest are removed.
  Use a dedicated output directory. Other files remain.
- Concurrent writers to one output directory fail on `.yage-audio.lock`.
  After a killed process, remove that lock only after confirming no build is
  running.
- Watch mode polls the config JSON file and, with `--instruments`, every file
  the module imported at its last import. It keeps watching after an invalid
  edit, including a failed or missing config at start, and serializes builds.
  Reload the game after a successful rebuild.

## Runtime loading

`soundBank(unknownManifest, baseDirectoryUrl)` from `@yagejs/audio` validates
and declares `{ manifest, sounds: Record<string, AssetHandle<AudioBuffer>> }`.
The directory URL must end in `/`. This function performs no network work.
Fetch or import the manifest first, then put the handles in `Scene.preload`.
Use handles for playback, not the bank's local alias strings.

Each handle carries its entry's loop pair and rootNote into the sound
registry, so a music track using `bank.sounds[name]` needs no `rootNote`.
Loop metadata follows the handles through the existing sound loader.
Handles stay loaded until code unloads them through the AssetManager; no extra
bank plugin is installed.
