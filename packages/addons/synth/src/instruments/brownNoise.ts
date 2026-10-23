import { defineInstrument } from "../core/defineInstrument.js";
import { loopNoise, brownNoise as generateNoise } from "../core/dsp/noise.js";

export const brownNoise = /* @__PURE__ */ defineInstrument(
  "brownNoise",
  (_frequency, sampleRate, seed) => {
    // Its own generator only, so a bundle drops the other noise colours.
    const samples = loopNoise(generateNoise, 2, sampleRate, seed);
    return { samples, loopStart: 0, loopEnd: samples.length };
  },
  { pitched: false },
);
