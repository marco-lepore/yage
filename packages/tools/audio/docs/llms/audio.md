# @yagejs-tools/audio

Build-time rendering of selected synth sounds to mono PCM16 WAV files and
`SoundBankManifest` metadata. Node 22+. The tool is a development dependency.
The game uses `@yagejs/audio` asset handles and needs no synth import for an
exported bank.

## CLI

```sh
yage-audio instruments
yage-audio build audio.config.json --out public/audio
yage-audio build audio.config.json --out public/audio --watch
yage-audio inspect public/audio/manifest.json
```

Config is JSON with `version: 1`, optional `sampleRate` (default 44100),
`sounds: Record<string, { sound: SynthSound; rootNote?: number }>`, and optional
`include: string[]`. Omitted include exports all declared aliases. Includes must
be non-empty, unique, and present in sounds. Declare gameplay cue instruments
explicitly; game source is not scanned.

`SynthSound` is an instrument descriptor, patch, array of patches, or jingle.
An instrument descriptor is `{ instrument, frequency?, seed?, volume? }`.
Use `yage-audio instruments` for names, including flute, clarinet and organ.
Default frequency is middle C, seed 1, volume 0.3. Set `rootNote` to the
rendered MIDI pitch; it is metadata and does not change rendering.

## API

```ts
import { renderAudioBank } from "@yagejs-tools/audio";
const bank = await renderAudioBank({
  version: 1,
  sounds: { flute: { sound: { instrument: "flute", seed: 17 }, rootNote: 60 } },
});
console.log(
  bank.manifest,
  bank.files.map((file) => file.file),
);
```

- `parseAudioBankConfig(unknown): AudioBankConfig`: validate and copy.
- `renderAudioBank(unknown): Promise<RenderedAudioBank>`: no filesystem or
  AudioContext. Returns `{ manifest, files: { file, data: Uint8Array }[] }`.
- `listAudioInstruments(): readonly SynthInstrumentName[]`: shared catalogue.
- `/node`: `buildAudioBank(unknown, { outDir }): Promise<SoundBankManifest>`.
- `/node`: `inspectAudioBank(manifestPath): Promise<AudioBankInspection>`.
  Validates resource hashes and WAV headers, returns manifest, aliases, files,
  wavBytes and decodedBytes. Decoded estimate uses mono float32 at source rate;
  resampling and decoder overhead are excluded.

## Output and validation

- WAV filenames use SHA-256 of encoded bytes. Identical renders share a file.
  Identical descriptors render once per build; persistent render caching is
  not provided.
- Manifest version 1: sampleRate and sounds keyed by alias. Each entry has file,
  frames, bytes, samplePeak, rms, clippedSamples, optional rootNote, and paired
  loopStart/loopEnd in seconds.
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
- Watch mode observes the JSON file, survives invalid edits, and serializes
  builds. Reload the game after a successful rebuild.

## Runtime loading

`soundBank(unknownManifest, baseDirectoryUrl)` from `@yagejs/audio` validates
and declares `{ manifest, sounds: Record<string, AssetHandle<AudioBuffer>> }`.
The directory URL must end in `/`. This function performs no network work.
Fetch or import the manifest first, then put the handles in `Scene.preload`.
Use handles for playback, not the bank's local alias strings.

Use `bank.manifest.sounds[name].rootNote` for a music track's rootNote.
Loop metadata follows the handles through the existing sound loader.
Scene asset reference counting owns loading and unloading; no extra bank
plugin is installed.
