import { defineInstrument } from "../core/defineInstrument.js";
import { renderRide } from "../core/dsp/drums.js";

export const ride = /* @__PURE__ */ defineInstrument(
  "ride",
  (_frequency, sampleRate, seed) => ({
    data: renderRide(sampleRate, seed),
    sampleRate,
  }),
);
