import { defineInstrument } from "../core/defineInstrument.js";
import { renderAdditive } from "../core/dsp/additive.js";

export const flute = /* @__PURE__ */ defineInstrument(
  "flute",
  (frequency, sampleRate, seed) =>
    renderAdditive(
      {
        harmonics: [
          1,
          0.07 + 0.3 * 0.65,
          0.018 + 0.12 * 0.65,
          0.008 + 0.06 * 0.65,
          0.004 + 0.027 * 0.65,
          0.002 + 0.012 * 0.65,
          0.001 + 0.005 * 0.65,
          0.0005 + 0.002 * 0.65,
        ],
        breath: true,
        frequency,
        seed,
      },
      sampleRate,
    ),
);
