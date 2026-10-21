import { defineInstrument } from "../core/defineInstrument.js";
import { renderLowTom } from "../core/dsp/drums.js";

export const tom = /* @__PURE__ */ defineInstrument(
  "tom",
  (_frequency, sampleRate, seed) => ({
    data: renderLowTom(sampleRate, seed),
    sampleRate,
  }),
);
