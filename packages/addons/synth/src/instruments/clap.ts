import { defineInstrument } from "../core/defineInstrument.js";
import { renderClap } from "../core/dsp/drums.js";

export const clap = /* @__PURE__ */ defineInstrument(
  "clap",
  (_frequency, sampleRate, seed) => ({
    data: renderClap(sampleRate, seed),
    sampleRate,
  }),
);
