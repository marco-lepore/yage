import type {
  SynthInstrumentDefinition,
  SynthInstrumentOptions,
} from "./instruments.js";

/** Mono samples with a sustain loop, in sample indices. */
export interface SynthRenderLoop {
  readonly samples: Float32Array;
  readonly loopStart: number;
  readonly loopEnd: number;
}
/** What an instrument's render function returns: mono samples, optionally with a sustain loop. */
export type SynthRenderResult = Float32Array | SynthRenderLoop;

/**
 * Make an instrument from a render function. The function receives the
 * frequency in Hz, the sample rate and a uint32 seed, and returns samples
 * peaking at about 0.87, as `limit(normalize(out, 0.9))` leaves them. The
 * definition validates the options and the returned loop, scales the samples
 * by `volume` (default 0.3) in place, converts a sustain loop to seconds and,
 * for a pitched instrument, reports the MIDI note of the frequency as
 * `rootNote`. Return a new buffer on every call.
 *
 * Drums and noise, which ignore the frequency, set `pitched: false`. One that
 * sounds at a fixed pitch, such as a tuned drum, also sets that pitch as
 * `rootNote` so music notes transpose it.
 */
export function defineInstrument<Name extends string>(
  name: Name,
  render: (
    frequency: number,
    sampleRate: number,
    seed: number,
  ) => SynthRenderResult,
  options: { pitched?: boolean; rootNote?: number } = {},
): SynthInstrumentDefinition<Name> {
  const pitched = options.pitched ?? true;
  const fixedRoot = options.rootNote;
  if (fixedRoot !== undefined) {
    if (pitched)
      throw new Error(
        `defineInstrument("${name}"): rootNote is for an instrument with pitched: false; a pitched instrument takes it from the frequency.`,
      );
    if (!Number.isFinite(fixedRoot) || fixedRoot < 0 || fixedRoot > 127)
      throw new Error(
        `defineInstrument("${name}"): rootNote must be a MIDI pitch from 0 to 127, got ${fixedRoot}.`,
      );
  }
  return {
    name,
    pitched,
    sound: (options: SynthInstrumentOptions = {}) => ({
      ...options,
      instrument: name,
    }),
    render(options: SynthInstrumentOptions = {}, sampleRate = 44100) {
      if (
        !Number.isFinite(sampleRate) ||
        sampleRate < 8000 ||
        sampleRate > 96000
      )
        throw new Error(
          `renderSynthInstrument: sampleRate must be 8000..96000, got ${sampleRate}.`,
        );
      const frequency = options.frequency ?? 261.625565;
      if (
        !Number.isFinite(frequency) ||
        frequency < 20 ||
        frequency > Math.min(4000, sampleRate / 4)
      )
        throw new Error(
          `renderSynthInstrument: frequency must be 20..min(4000, sampleRate/4), got ${frequency}.`,
        );
      const seed = options.seed ?? 1;
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw new Error(
          `renderSynthInstrument: seed must be uint32, got ${seed}.`,
        );
      const volume = options.volume ?? 0.3;
      if (!Number.isFinite(volume) || volume < 0 || volume > 1)
        throw new Error(
          `renderSynthInstrument: volume must be 0..1, got ${volume}.`,
        );

      const result = render(frequency, sampleRate, seed);
      const samples = result instanceof Float32Array ? result : result.samples;
      if (samples.length < 1)
        throw new Error(`Instrument "${name}": render returned no samples.`);
      if (
        !(result instanceof Float32Array) &&
        !(
          Number.isInteger(result.loopStart) &&
          Number.isInteger(result.loopEnd) &&
          result.loopStart >= 0 &&
          result.loopStart < result.loopEnd &&
          result.loopEnd <= samples.length
        )
      )
        throw new Error(
          `Instrument "${name}": render returned loop ${result.loopStart}..${result.loopEnd}; expected sample indices with 0 <= loopStart < loopEnd <= ${samples.length}.`,
        );
      for (let i = 0; i < samples.length; i++)
        samples[i] = samples[i]! * volume;
      const rootNote = pitched ? midiNote(frequency) : fixedRoot;
      return {
        samples,
        sampleRate,
        ...(rootNote === undefined ? {} : { rootNote }),
        ...(result instanceof Float32Array
          ? {}
          : {
              loopStart: result.loopStart / sampleRate,
              loopEnd: result.loopEnd / sampleRate,
            }),
      };
    },
  };
}

/** MIDI note of a frequency (A4 = 440 Hz = 69), rounded to 1/10000 semitone. */
function midiNote(frequency: number): number {
  return Math.round((69 + 12 * Math.log2(frequency / 440)) * 1e4) / 1e4;
}
