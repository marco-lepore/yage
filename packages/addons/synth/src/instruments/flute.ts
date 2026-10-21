import { defineInstrument } from "../core/defineInstrument.js";
import { renderAdditiveInstrument } from "../core/dsp/additive.js";

export const flute = /* @__PURE__ */ defineInstrument(
  "flute",
  (frequency, sampleRate, seed) =>
    renderAdditiveInstrument(
      [
        1,
        0.07 + 0.3 * 0.65,
        0.018 + 0.12 * 0.65,
        0.008 + 0.06 * 0.65,
        0.004 + 0.027 * 0.65,
        0.002 + 0.012 * 0.65,
        0.001 + 0.005 * 0.65,
        0.0005 + 0.002 * 0.65,
      ],
      true,
      frequency,
      sampleRate,
      seed,
    ),
);
