import { defineInstrument } from "../core/defineInstrument.js";
import { renderBrushTap } from "../core/dsp/drums.js";

export const brushTap = /* @__PURE__ */ defineInstrument(
  "brushTap",
  (_frequency, sampleRate, seed) => ({
    data: renderBrushTap(sampleRate, seed, false),
    sampleRate,
  }),
);
