import { defineInstrument } from "../core/defineInstrument.js";
import { renderRim } from "../core/dsp/drums.js";

export const rim = /* @__PURE__ */ defineInstrument(
  "rim",
  (_frequency, sampleRate, seed) => ({
    data: renderRim(sampleRate, seed),
    sampleRate,
  }),
);
