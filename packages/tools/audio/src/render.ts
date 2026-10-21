import { synthInstruments } from "@yagejs-addons/synth/instruments";
import { renderSynthSample } from "@yagejs-addons/synth/render";
import type {
  SynthInstrumentName,
  SynthSample,
} from "@yagejs-addons/synth/render";
import { measureAudio, parseSoundBankManifest } from "@yagejs/audio";
import type { SoundBankManifest, SoundBankEntry } from "@yagejs/audio";
import { parseAudioBankConfig } from "./config.js";
import { encodeWav } from "./wav.js";

export interface AudioBankFile {
  readonly file: string;
  readonly data: Uint8Array;
}
export interface RenderedAudioBank {
  readonly manifest: SoundBankManifest;
  readonly files: readonly AudioBankFile[];
}
/** Catalogue names come from the same presets used by runtime rendering. */
export function listAudioInstruments(): readonly SynthInstrumentName[] {
  return Object.keys(synthInstruments) as SynthInstrumentName[];
}
/** Render a bank in memory for export or preview. No filesystem or AudioContext. */
export async function renderAudioBank(
  input: unknown,
): Promise<RenderedAudioBank> {
  const config = parseAudioBankConfig(input);
  const sampleRate = config.sampleRate!;
  const sounds: Record<string, SoundBankEntry> = {};
  const files = new Map<string, AudioBankFile>();
  const rendered = new Map<string, SoundBankEntry>();
  for (const alias of [
    ...(config.include ?? Object.keys(config.sounds)),
  ].sort()) {
    const spec = config.sounds[alias]!;
    const key = JSON.stringify(spec.sound, canonical);
    let entry = rendered.get(key);
    if (!entry) {
      try {
        const sample = renderSynthSample(
          spec.sound,
          sampleRate,
          synthInstruments,
        );
        entry = await exportSample(sample, files);
      } catch (error) {
        throw new Error(
          `AudioBank ${alias}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      rendered.set(key, entry);
    }
    Object.defineProperty(sounds, alias, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        ...entry,
        ...(spec.rootNote === undefined ? {} : { rootNote: spec.rootNote }),
      },
    });
  }
  return {
    manifest: parseSoundBankManifest({ version: 1, sampleRate, sounds }),
    files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)),
  };
}
async function exportSample(
  sample: SynthSample,
  files: Map<string, AudioBankFile>,
): Promise<SoundBankEntry> {
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
