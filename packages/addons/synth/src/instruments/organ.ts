import { defineInstrument } from "../core/defineInstrument.js";
import { renderAdditive } from "../core/dsp/additive.js";

export const organ = /* @__PURE__ */ defineInstrument(
  "organ",
  (frequency, sampleRate, seed) =>
    renderAdditive(
      {
        harmonics: [1, 0.55, 0.35, 0.28, 0.1, 0.08, 0.04, 0.1],
        breath: false,
        frequency,
        seed,
      },
      sampleRate,
    ),
);
