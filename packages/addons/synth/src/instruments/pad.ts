import { defineInstrument } from "../core/defineInstrument.js";
import { renderPad } from "../core/dsp/pad.js";

export const pad = /* @__PURE__ */ defineInstrument("pad", renderPad);
