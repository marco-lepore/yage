import { defineInstrument } from "../core/defineInstrument.js";
import { renderAdditiveInstrument } from "../core/dsp/additive.js";

export const clarinet = /* @__PURE__ */ defineInstrument(
  "clarinet",
  (frequency, sampleRate, seed) =>
    renderAdditiveInstrument(
      [1, 0.025, 0.42, 0.015, 0.19, 0.008, 0.08, 0.004],
      true,
      frequency,
      sampleRate,
      seed,
    ),
);
