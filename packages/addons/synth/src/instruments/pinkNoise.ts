import { defineInstrument } from "../core/defineInstrument.js";
import { loopNoise, pinkNoise as generateNoise } from "../core/dsp/noise.js";

export const pinkNoise = /* @__PURE__ */ defineInstrument(
  "pinkNoise",
  (_frequency, sampleRate, seed) => {
    const data = loopNoise(generateNoise, 2, sampleRate, seed);
    return { data, sampleRate, loopStart: 0, loopEnd: data.length };
  },
);
