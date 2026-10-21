import { defineInstrument } from "../core/defineInstrument.js";
import { renderElectricPiano } from "../core/dsp/keys.js";

export const electricPiano = /* @__PURE__ */ defineInstrument(
  "electricPiano",
  (frequency, sampleRate, seed) => ({
    data: renderElectricPiano(frequency, sampleRate, seed),
    sampleRate,
  }),
);
