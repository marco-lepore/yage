import { defineInstrument } from "../core/defineInstrument.js";
import { loopNoise, brownNoise as generateNoise } from "../core/dsp/noise.js";

export const brownNoise = /* @__PURE__ */ defineInstrument(
  "brownNoise",
  (_frequency, sampleRate, seed) => {
    const data = loopNoise(generateNoise, 2, sampleRate, seed);
    return { data, sampleRate, loopStart: 0, loopEnd: data.length };
  },
);
