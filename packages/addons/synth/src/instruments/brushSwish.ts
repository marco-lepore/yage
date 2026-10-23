import { defineInstrument } from "../core/defineInstrument.js";
import { renderBrushSwish } from "../core/dsp/drums.js";

export const brushSwish = /* @__PURE__ */ defineInstrument(
  "brushSwish",
  (_frequency, sampleRate, seed) => renderBrushSwish(sampleRate, seed),
  { pitched: false },
);
