import { defineInstrument } from "../core/defineInstrument.js";
import { LOW_TOM_ROOT, renderLowTom } from "../core/dsp/drums.js";

export const tom = /* @__PURE__ */ defineInstrument(
  "tom",
  (_frequency, sampleRate, seed) => renderLowTom(sampleRate, seed),
  // A tuned drum: it ignores the frequency but sounds at a known pitch.
  { pitched: false, rootNote: LOW_TOM_ROOT },
);
