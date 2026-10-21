import { defineInstrument } from "../core/defineInstrument.js";
import { renderKalimba } from "../core/dsp/mallet.js";

export const kalimba = /* @__PURE__ */ defineInstrument(
  "kalimba",
  (frequency, sampleRate, seed) => ({
    data: renderKalimba(frequency, sampleRate, seed),
    sampleRate,
  }),
);
