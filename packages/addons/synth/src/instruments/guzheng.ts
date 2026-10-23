import { defineInstrument } from "../core/defineInstrument.js";
import { renderGuzheng } from "../core/dsp/pluck.js";

export const guzheng = /* @__PURE__ */ defineInstrument(
  "guzheng",
  (frequency, sampleRate, seed) => renderGuzheng(frequency, sampleRate, seed),
);
