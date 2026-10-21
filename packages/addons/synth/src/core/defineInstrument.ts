import type {
  SynthInstrumentDefinition,
  SynthInstrumentName,
  SynthInstrumentOptions,
} from "./instruments.js";
import type { Rendered } from "./dsp/util.js";

/** Shared bounds, gain and sustain conversion for the built-in instruments. */
export function defineInstrument(
  name: SynthInstrumentName,
  render: (frequency: number, sampleRate: number, seed: number) => Rendered,
): SynthInstrumentDefinition {
  return {
    name,
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
      for (let i = 0; i < result.data.length; i++)
        result.data[i] = result.data[i]! * volume;
      return {
        samples: result.data,
        sampleRate,
        ...(result.loopStart === undefined
          ? {}
          : {
              loopStart: result.loopStart / sampleRate,
              loopEnd: result.loopEnd! / sampleRate,
            }),
      };
    },
  };
}
