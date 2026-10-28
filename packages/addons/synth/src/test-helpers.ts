// Custom instruments written the way a game writes them: only the public
// authoring API from the `/render` entry.
import {
  biquad,
  defineInstrument,
  limit,
  normalize,
  renderAdditive,
  renderMetal,
  renderString,
} from "./render.js";

/** A pitched pluck with no sustain loop. */
export const harp = defineInstrument("harp", (frequency, sampleRate, seed) => {
  const out = renderString(
    {
      frequency,
      duration: 0.6,
      t60: 0.5,
      brightness: 0.7,
      pickPosition: 0.4,
      seed,
    },
    sampleRate,
  );
  return limit(normalize(out, 0.9));
});

/** A pitched sustained tone with a sustain loop. */
export const reed = defineInstrument("reed", (frequency, sampleRate, seed) =>
  renderAdditive(
    { frequency, seed, harmonics: [1, 0.5, 0.3, 0.2], breath: true },
    sampleRate,
  ),
);

/** An unpitched hit: the frequency is ignored and the sample has no root note. */
export const hat = defineInstrument(
  "hat",
  (_frequency, sampleRate, seed) => {
    const out = renderMetal(
      { duration: 0.12, t60: 0.05, frequencyScale: 1.9, seed },
      sampleRate,
    );
    biquad(out, "highpass", 3000, 0.7, sampleRate);
    return limit(normalize(out, 0.9));
  },
  { pitched: false },
);
