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
  SynthInstrument,
  SynthInstrumentName,
  SynthInstrumentOptions,
  SynthInstrumentDefinition,
  SynthInstrumentBank,
  SynthSample,
} from "./core/instruments.js";
export { parseSynthSound } from "./core/parse.js";
export { synthPresets } from "./core/presets.js";
export type * from "./core/types.js";
