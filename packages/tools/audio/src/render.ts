import { synthInstruments } from "@yagejs-addons/synth/instruments";
import { renderSynthSample } from "@yagejs-addons/synth/render";
import type {
  SynthInstrumentBank,
  SynthSample,
} from "@yagejs-addons/synth/render";
import { measureAudio } from "@yagejs/audio";
import { parseAudioBankConfig } from "./config.js";
import {
  parseExportedManifest,
  type ExportedSoundBankEntry,
  type ExportedSoundBankManifest,
} from "./manifest.js";
import { encodeWav } from "./wav.js";

/** One encoded WAV file of a rendered bank. */
export interface AudioBankFile {
  /** Content-hash filename, the same name the manifest lists. */
  readonly file: string;
  readonly data: Uint8Array;
}
/** A bank rendered in memory: the manifest plus each distinct WAV file. */
export interface RenderedAudioBank {
  readonly manifest: ExportedSoundBankManifest;
  readonly files: readonly AudioBankFile[];
}
/** Options for `renderAudioBank` and `buildAudioBank`. */
export interface AudioBankRenderOptions {
  /** The instruments sounds may name. Default: the 25 built-in instruments. */
  instruments?: SynthInstrumentBank;
}
/** The instrument names a config may use with `instruments`, sorted. */
export function listAudioInstruments(
  instruments: SynthInstrumentBank = synthInstruments,
): readonly string[] {
  return Object.values(instruments)
    .map((definition) => definition.name)
    .sort();
}
/** Render a bank in memory for export or preview. No filesystem or AudioContext. */
export async function renderAudioBank(
  input: unknown,
  options: AudioBankRenderOptions = {},
): Promise<RenderedAudioBank> {
  const instruments: SynthInstrumentBank =
    options.instruments ?? synthInstruments;
  const config = parseAudioBankConfig(input, instruments);
  const sampleRate = config.sampleRate!;
  const sounds: Record<string, ExportedSoundBankEntry> = {};
  const files = new Map<string, AudioBankFile>();
  const rendered = new Map<string, ExportedSoundBankEntry>();
  // A file loads once per path, so every alias of one file shares its metadata.
  const roots = new Map<
    string,
    { alias: string; rootNote: number | undefined }
  >();
  for (const alias of [
    ...(config.include ?? Object.keys(config.sounds)),
  ].sort()) {
    const spec = config.sounds[alias]!;
    const key = JSON.stringify(spec.sound, canonical);
    let entry = rendered.get(key);
    if (!entry) {
      try {
        const sample = renderSynthSample(spec.sound, sampleRate, instruments);
        entry = await exportSample(sample, files);
      } catch (error) {
        throw new Error(
          `AudioBank ${alias}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      rendered.set(key, entry);
    }
    // An explicit config value overrides the instrument's own pitch.
    const rootNote = spec.rootNote ?? entry.rootNote;
    const shared = roots.get(entry.file);
    if (shared && shared.rootNote !== rootNote)
      throw new Error(
        `AudioBank ${alias}: renders the same audio as "${shared.alias}" with a different rootNote (${String(rootNote)}, not ${String(shared.rootNote)}). Give one of them a different sound or the same rootNote.`,
      );
    roots.set(entry.file, { alias, rootNote });
    Object.defineProperty(sounds, alias, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: rootNote === undefined ? { ...entry } : { ...entry, rootNote },
    });
  }
  return {
    manifest: parseExportedManifest({ version: 1, sampleRate, sounds }),
    files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)),
  };
}
async function exportSample(
  sample: SynthSample,
  files: Map<string, AudioBankFile>,
): Promise<ExportedSoundBankEntry> {
  const metrics = measureAudio([sample.samples], sample.sampleRate);
  if (metrics.nonFiniteSamples || metrics.clippedSamples)
    throw new Error(
      `AudioBank: rendered sample has ${metrics.nonFiniteSamples} non-finite and ${metrics.clippedSamples} clipped samples. Reduce its volume.`,
    );
  const data = encodeWav(sample.samples, sample.sampleRate);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data as Uint8Array<ArrayBuffer>,
  );
  const file = `${Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("")}.wav`;
  files.set(file, { file, data });
  return {
    file,
    frames: sample.samples.length,
    bytes: data.length,
    samplePeak: metrics.samplePeak,
    rms: metrics.rms,
    clippedSamples: metrics.clippedSamples,
    ...(sample.rootNote === undefined ? {} : { rootNote: sample.rootNote }),
    ...(sample.loopStart === undefined
      ? {}
      : { loopStart: sample.loopStart, loopEnd: sample.loopEnd! }),
  };
}
function canonical(_key: string, value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      )
    : value;
}
