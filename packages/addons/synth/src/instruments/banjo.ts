import { defineInstrument } from "../core/defineInstrument.js";
import { renderBanjo } from "../core/dsp/pluck.js";

export const banjo = /* @__PURE__ */ defineInstrument(
  "banjo",
  (frequency, sampleRate, seed) => renderBanjo(frequency, sampleRate, seed),
);
