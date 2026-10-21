import { defineInstrument } from "../core/defineInstrument.js";
import { renderShaker } from "../core/dsp/drums.js";

export const shaker = /* @__PURE__ */ defineInstrument(
  "shaker",
  (_frequency, sampleRate, seed) => ({
    data: renderShaker(sampleRate, seed),
    sampleRate,
  }),
);
