import {
  biquad,
  defineInstrument,
  limit,
  normalize,
  renderString,
} from "@yagejs-addons/synth/render";

/**
 * A custom instrument: a bright harp string plucked near the middle. It
 * imports only from `@yagejs-addons/synth/render`, so the same module also
 * loads in a worker or in the audio build tool.
 */
export const harp = defineInstrument("harp", (frequency, sampleRate, seed) => {
  const t60 = Math.min(3, Math.max(1, 3 - (frequency - 200) / 500));
  const out = renderString(
    {
      frequency,
      duration: t60 + 0.2,
      t60,
      brightness: 0.7,
      pickPosition: 0.4,
      seed,
    },
    sampleRate,
  );
  biquad(out, "highpass", 80, 0.7, sampleRate);
  return limit(normalize(out, 0.9));
});
