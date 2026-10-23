import type { AssetHandle } from "@yagejs/core";
import { sound } from "./assets.js";

/**
 * One sound in a bank manifest. The runtime reads `file`, the loop points and
 * `rootNote`. The other fields are build diagnostics that `@yagejs-tools/audio`
 * writes; a hand-written manifest can leave them out.
 */
export interface SoundBankEntry {
  /** WAV filename inside the bank directory. */
  file: string;
  /** Sample frames in the file. */
  frames?: number;
  /** File size in bytes. */
  bytes?: number;
  /** Largest absolute sample value before PCM16 encoding. */
  samplePeak?: number;
  rms?: number;
  clippedSamples?: number;
  /** MIDI pitch the recording sounds at its original rate. */
  rootNote?: number;
  /** Sustain loop start in seconds. Set together with `loopEnd`. */
  loopStart?: number;
  loopEnd?: number;
}
/** WAV files in one directory, listed by bank name. Loop points are seconds, independent of decode rate. */
export interface SoundBankManifest {
  version: 1;
  sampleRate: number;
  sounds: Record<string, SoundBankEntry>;
}
/** Asset handles for every sound in a bank, plus the manifest they came from. */
export interface SoundBank {
  readonly manifest: SoundBankManifest;
  /** Bank name → preloadable handle. Pass these to `Scene.preload` and playback. */
  readonly sounds: Readonly<Record<string, AssetHandle<AudioBuffer>>>;
}

/** Validate a JSON bank before declaring or loading its assets. Returns a copy. */
export function parseSoundBankManifest(value: unknown): SoundBankManifest {
  if (!isObject(value) || value.version !== 1 || !isObject(value.sounds))
    throw new Error("SoundBank: expected version 1 and a sounds object.");
  finite("sampleRate", value.sampleRate, 8000, 96000, true);
  const sampleRate = value.sampleRate as number;
  const entries = Object.entries(value.sounds);
  if (!entries.length) throw new Error("SoundBank: sounds must not be empty.");
  const resources = new Map<string, string>();
  for (const [alias, entry] of entries) {
    if (!alias.trim() || !isObject(entry))
      throw new Error(`SoundBank ${alias}: expected a named sound entry.`);
    if (
      typeof entry.file !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.wav$/.test(entry.file)
    )
      throw new Error(
        `SoundBank ${alias}.file: expected a WAV filename without directories.`,
      );
    optional(`${alias}.frames`, entry.frames, 1, 0x7fffffff, true);
    optional(`${alias}.bytes`, entry.bytes, 46, 0xffffffff, true);
    optional(`${alias}.samplePeak`, entry.samplePeak, 0, Number.MAX_VALUE);
    optional(`${alias}.rms`, entry.rms, 0, Number.MAX_VALUE);
    optional(
      `${alias}.clippedSamples`,
      entry.clippedSamples,
      0,
      (entry.frames as number | undefined) ?? 0x7fffffff,
      true,
    );
    optional(`${alias}.rootNote`, entry.rootNote, 0, 127);
    if (entry.loopStart !== undefined || entry.loopEnd !== undefined) {
      // Without a frame count the decoder checks the loop against the file.
      const seconds =
        entry.frames === undefined
          ? Number.MAX_VALUE
          : (entry.frames as number) / sampleRate;
      finite(`${alias}.loopStart`, entry.loopStart, 0, seconds);
      finite(`${alias}.loopEnd`, entry.loopEnd, 0, seconds);
      if ((entry.loopEnd as number) <= (entry.loopStart as number))
        throw new Error(`SoundBank ${alias}: loopEnd must follow loopStart.`);
    }
    // One file loads once, so every entry naming it must agree.
    const metadata = JSON.stringify([
      entry.frames,
      entry.bytes,
      entry.loopStart,
      entry.loopEnd,
      entry.rootNote,
    ]);
    const previous = resources.get(entry.file);
    if (previous !== undefined && previous !== metadata)
      throw new Error(
        `SoundBank ${alias}: conflicting metadata for ${entry.file}.`,
      );
    resources.set(entry.file, metadata);
  }
  return structuredClone(value) as unknown as SoundBankManifest;
}

/** Declare bank handles for Scene.preload. This function performs no I/O. */
export function soundBank(value: unknown, basePath: string): SoundBank {
  const manifest = parseSoundBankManifest(value);
  if (!basePath.trim() || !basePath.endsWith("/"))
    throw new Error(
      "soundBank: basePath must be a non-empty directory URL ending in /.",
    );
  const sounds = Object.fromEntries(
    Object.entries(manifest.sounds).map(([alias, entry]) => [
      alias,
      // sound() keeps only the loop points and rootNote.
      sound(`${basePath}${entry.file}`, entry),
    ]),
  );
  return { manifest, sounds };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function finite(
  name: string,
  value: unknown,
  min: number,
  max: number,
  integer = false,
): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(
      `SoundBank ${name}: expected ${integer ? "an integer" : "a finite number"} from ${min} to ${max}, got ${String(value)}.`,
    );
}
function optional(
  name: string,
  value: unknown,
  min: number,
  max: number,
  integer = false,
): void {
  if (value !== undefined) finite(name, value, min, max, integer);
}
