import { defineInstrument } from "../core/defineInstrument.js";
import { renderBell } from "../core/dsp/mallet.js";

export const bell = /* @__PURE__ */ defineInstrument(
  "bell",
  (frequency, sampleRate, seed) => ({
    data: renderBell(frequency, sampleRate, seed),
    sampleRate,
  }),
);
