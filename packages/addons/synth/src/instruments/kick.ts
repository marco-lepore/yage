import { defineInstrument } from "../core/defineInstrument.js";
import { renderKick } from "../core/dsp/drums.js";

export const kick = /* @__PURE__ */ defineInstrument(
  "kick",
  (_frequency, sampleRate, seed) => renderKick(sampleRate, seed),
  { pitched: false },
);
