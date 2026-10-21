import { defineInstrument } from "../core/defineInstrument.js";
import { renderKick } from "../core/dsp/drums.js";

export const kick = /* @__PURE__ */ defineInstrument(
  "kick",
  (_frequency, sampleRate, seed) => ({
    data: renderKick(sampleRate, seed),
    sampleRate,
  }),
);
