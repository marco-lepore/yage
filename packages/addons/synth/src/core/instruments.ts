export interface SynthInstrumentOptions {
  /** Root pitch in Hz. Default middle C; drums ignore pitch. */
  frequency?: number;
  /** Deterministic uint32 seed. Default 1. */
  seed?: number;
  /** Output multiplier, 0..1. Default 0.3. */
  volume?: number;
}
/** Portable data naming an instrument; a bank resolves it to a definition. */
export interface SynthInstrument<
  Name extends string = string,
> extends SynthInstrumentOptions {
  instrument: Name;
}
export interface SynthSample {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /**
   * MIDI note of a pitched instrument's frequency, or the fixed pitch an
   * unpitched instrument declares, such as the tom's 43. Absent otherwise.
   */
  readonly rootNote?: number;
  /** Sustain region in seconds. */
  readonly loopStart?: number;
  readonly loopEnd?: number;
}
/** An instrument made with `defineInstrument`: a name plus a seeded renderer. */
export interface SynthInstrumentDefinition<Name extends string = string> {
  readonly name: Name;
  /** False for drums and noise, which ignore `frequency`. */
  readonly pitched: boolean;
  /** Portable descriptor for this instrument, for plugin config, workers and build files. */
  sound(options?: SynthInstrumentOptions): SynthInstrument<Name>;
  /** Render one sample. Throws for out-of-range options. */
  render(options?: SynthInstrumentOptions, sampleRate?: number): SynthSample;
}
/**
 * The instrument definitions a renderer may use. Keys are free: a descriptor
 * resolves to the definition whose `name` equals its `instrument`.
 */
export type SynthInstrumentBank = Readonly<
  Record<string, SynthInstrumentDefinition>
>;
/** The names a bank's definitions declare. `string` for a bank typed as `SynthInstrumentBank`. */
export type SynthBankNames<Bank extends SynthInstrumentBank> =
  Bank[keyof Bank]["name"];

/** Resolve a descriptor using the caller's instrument set. */
export function resolveSynthInstrument(
  sound: SynthInstrument,
  instruments: SynthInstrumentBank,
): SynthInstrumentDefinition {
  const matches = new Set(
    Object.values(instruments).filter(
      (definition) => definition.name === sound.instrument,
    ),
  );
  if (matches.size > 1)
    throw new Error(
      `renderSynthInstrument: the instrument set has two definitions named "${sound.instrument}".`,
    );
  const [definition] = matches;
  if (!definition)
    throw new Error(
      `renderSynthInstrument: instrument "${String(sound.instrument)}" is not registered.`,
    );
  return definition;
}
/**
 * Render an instrument descriptor with a definition from `instruments`.
 * Passing the bank as a literal checks the descriptor's name at compile time.
 */
export function renderSynthInstrument<
  Bank extends SynthInstrumentBank = SynthInstrumentBank,
>(
  sound: SynthInstrument<SynthBankNames<Bank>>,
  sampleRate = 44100,
  instruments?: Bank,
): SynthSample {
  return resolveSynthInstrument(sound, instruments ?? {}).render(
    sound,
    sampleRate,
  );
}
