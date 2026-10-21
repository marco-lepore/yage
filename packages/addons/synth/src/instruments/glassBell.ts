import { defineInstrument } from "../core/defineInstrument.js";
import { renderGlassBell } from "../core/dsp/mallet.js";

export const glassBell = /* @__PURE__ */ defineInstrument(
  "glassBell",
  (frequency, sampleRate, seed) => ({
    data: renderGlassBell(frequency, sampleRate, seed),
    sampleRate,
  }),
);
