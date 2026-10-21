import { defineInstrument } from "../core/defineInstrument.js";
import { renderUprightBass } from "../core/dsp/pluck.js";

export const uprightBass = /* @__PURE__ */ defineInstrument(
  "uprightBass",
  (frequency, sampleRate, seed) => ({
    data: renderUprightBass(frequency, sampleRate, seed),
    sampleRate,
  }),
);
