import { defineInstrument } from "../core/defineInstrument.js";
import { renderBass } from "../core/dsp/pluck.js";

export const bass = /* @__PURE__ */ defineInstrument(
  "bass",
  (frequency, sampleRate, seed) => ({
    data: renderBass(frequency, sampleRate, seed),
    sampleRate,
  }),
);
