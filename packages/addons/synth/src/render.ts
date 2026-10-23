/** Rendering API for Node, workers and browser previews. No Web Audio objects. */
export {
  renderSynthPatch,
  renderSynthJingle,
  renderSynthSound,
  SYNTH_SAMPLE_RATE,
} from "./core/render.js";
export { renderSynthSample } from "./core/sample.js";
export { renderSynthInstrument } from "./core/instruments.js";
export type {
  SynthBankNames,
  SynthInstrument,
  SynthInstrumentOptions,
  SynthInstrumentDefinition,
  SynthInstrumentBank,
  SynthSample,
} from "./core/instruments.js";
export { parseSynthSound } from "./core/parse.js";
export { synthPresets } from "./core/presets.js";
export type * from "./core/types.js";

// --- Instrument authoring ---
// Instrument modules import from this entry: it loads in the browser, a module
// worker and Node without engine imports.
export { defineInstrument } from "./core/defineInstrument.js";
export type {
  SynthRenderLoop,
  SynthRenderResult,
} from "./core/defineInstrument.js";
export { renderString } from "./core/dsp/pluck.js";
export type { SynthStringOptions } from "./core/dsp/pluck.js";
export { renderModal } from "./core/dsp/mallet.js";
export type {
  SynthModalOptions,
  SynthModalPartial,
} from "./core/dsp/mallet.js";
export { renderAdditive } from "./core/dsp/additive.js";
export type { SynthAdditiveOptions } from "./core/dsp/additive.js";
export { renderNoise } from "./core/dsp/noise.js";
export type { SynthNoiseOptions } from "./core/dsp/noise.js";
export { renderMetal } from "./core/dsp/drums.js";
export type { SynthMetalOptions } from "./core/dsp/drums.js";
export { biquad, svf } from "./core/dsp/filters.js";
export type { SynthBiquadType, SynthSvfMode } from "./core/dsp/filters.js";
export {
  dcBlock,
  fadeIn,
  fadeOut,
  limit,
  normalize,
  prepareTonalLoop,
  saturate,
} from "./core/dsp/util.js";
export { seededRandom } from "./core/random.js";
