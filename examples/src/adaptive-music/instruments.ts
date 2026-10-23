import {
  biquad,
  defineInstrument,
  limit,
  normalize,
  renderMetal,
} from "@yagejs-addons/synth/render";

/**
 * A custom instrument: a closed hi-hat. `SynthPlugin` renders it at boot
 * beside the built-in instruments.
 */
export const hat = defineInstrument(
  "hat",
  (_frequency, sampleRate, seed) => {
    const out = renderMetal(
      { duration: 0.12, t60: 0.05, frequencyScale: 1.9, seed },
      sampleRate,
    );
    biquad(out, "highpass", 7000, 0.7, sampleRate);
    return limit(normalize(out, 0.9));
  },
  { pitched: false },
);
