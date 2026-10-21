import { defineInstrument } from "../core/defineInstrument.js";
import { renderVibraphone } from "../core/dsp/mallet.js";

export const vibraphone = /* @__PURE__ */ defineInstrument(
  "vibraphone",
  (frequency, sampleRate, seed) => ({
    data: renderVibraphone(frequency, sampleRate, seed),
    sampleRate,
  }),
);
