import { synthInstruments } from "@yagejs-addons/synth/instruments";
import type { SynthInstrumentBank } from "@yagejs-addons/synth/render";
import { parseSynthSound } from "@yagejs-addons/synth/render";
import type { SynthSound } from "@yagejs-addons/synth/render";

export interface AudioBankSound {
  sound: SynthSound;
  /** MIDI pitch of the rendered sample. Omit for unpitched sounds. */
  rootNote?: number;
}
export interface AudioBankConfig {
  version: 1;
  sampleRate?: number;
  sounds: Record<string, AudioBankSound>;
  /** Aliases to export. Omit to export every declared sound. */
  include?: readonly string[];
}

/** Parse portable configuration before rendering or writing any files. */
export function parseAudioBankConfig(
  value: unknown,
  instruments: SynthInstrumentBank = synthInstruments,
): AudioBankConfig {
  const config = record(value, "AudioBank");
  keys(config, ["version", "sampleRate", "sounds", "include"], "AudioBank");
  if (config.version !== 1) throw new Error("AudioBank.version: expected 1.");
  const sampleRate = config.sampleRate ?? 44100;
  if (
    typeof sampleRate !== "number" ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000
  )
    throw new Error(
      `AudioBank.sampleRate: expected an integer from 8000 to 96000, got ${String(sampleRate)}.`,
    );
  const source = record(config.sounds, "AudioBank.sounds");
  const aliases = Object.keys(source);
  if (!aliases.length || aliases.length > 128)
    throw new Error("AudioBank.sounds: expected 1..128 entries.");
  const sounds = Object.fromEntries(
    aliases.map((alias) => {
      if (!alias.trim())
        throw new Error("AudioBank: aliases must not be empty.");
      const entry = record(source[alias], `AudioBank.sounds.${alias}`);
      keys(entry, ["sound", "rootNote"], `AudioBank.sounds.${alias}`);
      const rootNote = entry.rootNote;
      if (
        rootNote !== undefined &&
        (typeof rootNote !== "number" ||
          !Number.isFinite(rootNote) ||
          rootNote < 0 ||
          rootNote > 127)
      )
        throw new Error(
          `AudioBank ${alias}.rootNote: expected a finite MIDI pitch from 0 to 127.`,
        );
      let sound: SynthSound;
      try {
        sound = parseSynthSound(entry.sound, instruments);
      } catch (error) {
        throw new Error(
          `AudioBank ${alias}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return [
        alias,
        {
          sound,
          ...(rootNote === undefined ? {} : { rootNote: rootNote as number }),
        },
      ];
    }),
  );
  let include: string[] | undefined;
  if (config.include !== undefined) {
    if (!Array.isArray(config.include) || !config.include.length)
      throw new Error(
        "AudioBank.include: expected a non-empty array of aliases.",
      );
    include = [];
    for (const alias of config.include as unknown[]) {
      if (typeof alias !== "string" || !Object.hasOwn(sounds, alias))
        throw new Error(`AudioBank.include: unknown alias "${String(alias)}".`);
      if (include.includes(alias))
        throw new Error(`AudioBank.include: duplicate alias "${alias}".`);
      include.push(alias);
    }
  }
  return { version: 1, sampleRate, sounds, ...(include ? { include } : {}) };
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error(`${path}: expected a plain object.`);
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`${path}.${key}: unknown field.`);
}
