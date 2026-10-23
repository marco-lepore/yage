import { defineInstrument } from "../core/defineInstrument.js";
import { renderCymbal } from "../core/dsp/drums.js";

export const cymbal = /* @__PURE__ */ defineInstrument(
  "cymbal",
  (_frequency, sampleRate, seed) => renderCymbal(sampleRate, seed),
  { pitched: false },
);
