import { defineInstrument } from "../core/defineInstrument.js";
import { renderMarimba } from "../core/dsp/mallet.js";

export const marimba = /* @__PURE__ */ defineInstrument(
  "marimba",
  (frequency, sampleRate, seed) => renderMarimba(frequency, sampleRate, seed),
);
