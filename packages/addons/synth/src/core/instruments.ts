export type SynthInstrumentName =
  | "banjo"
  | "bass"
  | "uprightBass"
  | "guzheng"
  | "marimba"
  | "kalimba"
  | "glassBell"
  | "vibraphone"
  | "bell"
  | "electricPiano"
  | "pad"
  | "flute"
  | "clarinet"
  | "organ"
  | "kick"
  | "brushTap"
  | "brushSwish"
  | "shaker"
  | "rim"
  | "clap"
  | "ride"
  | "cymbal"
  | "tom"
  | "pinkNoise"
  | "brownNoise";
export interface SynthInstrumentOptions {
  /** Root pitch in Hz. Default middle C; drums ignore pitch. */
  frequency?: number;
  /** Deterministic uint32 seed. Default 1. */
  seed?: number;
  /** Output multiplier, 0..1. Default 0.3. */
  volume?: number;
}
export interface SynthInstrument extends SynthInstrumentOptions {
  instrument: SynthInstrumentName;
}
export interface SynthSample {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** Sustain region in seconds. */
  readonly loopStart?: number;
  readonly loopEnd?: number;
}
export interface SynthInstrumentDefinition {
  readonly name: SynthInstrumentName;
  sound(options?: SynthInstrumentOptions): SynthInstrument;
  render(options?: SynthInstrumentOptions, sampleRate?: number): SynthSample;
}
/** Only the instruments explicitly available to this renderer. */
export type SynthInstrumentBank = Readonly<
  Partial<Record<SynthInstrumentName, SynthInstrumentDefinition>>
>;

/** Resolve a descriptor using the caller's instrument set. */
export function resolveSynthInstrument(
  sound: SynthInstrument,
  instruments: SynthInstrumentBank,
): SynthInstrumentDefinition {
  const definition = Object.hasOwn(instruments, sound.instrument)
    ? instruments[sound.instrument]
    : undefined;
  if (!definition || definition.name !== sound.instrument)
    throw new Error(
      `renderSynthInstrument: instrument "${String(sound.instrument)}" is not registered.`,
    );
  return definition;
}
export function renderSynthInstrument(
  sound: SynthInstrument,
  sampleRate = 44100,
  instruments: SynthInstrumentBank = {},
): SynthSample {
  return resolveSynthInstrument(sound, instruments).render(sound, sampleRate);
}
