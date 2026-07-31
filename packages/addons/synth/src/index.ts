/**
 * @yagejs-addons/synth — procedural sound effects, no audio files.
 *
 * `src/core/` is plain math: a patch is data, and `renderSynthPatch` turns it into
 * samples with no WebAudio and no engine import, so a sound can be
 * unit-tested by asserting on the array. `synthBuffer` wraps samples in an
 * `AudioBuffer`, and `SynthPlugin` registers those buffers with
 * `@yagejs/audio` so they play through the engine's channels like preloaded
 * files. There is no view layer, so no `./presenters` subpath.
 */

// --- Headless synthesis (L1) ---
export {
  renderSynthJingle,
  renderSynthPatch,
  renderSynthSound,
  SYNTH_SAMPLE_RATE,
} from "./core/render.js";
export { synthPresets } from "./core/presets.js";
export type {
  SynthDialogueBeepsOptions,
  SynthFootstepOptions,
  SynthFootstepSurface,
  SynthJingleOverrides,
  SynthPatchOverrides,
} from "./core/presets.js";
export {
  synthVariantAliases,
  synthVariants,
  SYNTH_VARIANT_DETUNE,
} from "./core/variants.js";
export type { SynthVariant } from "./core/variants.js";
export type {
  SynthFilter,
  SynthFilterType,
  SynthJingle,
  SynthNote,
  SynthPatch,
  SynthSound,
  SynthVoice,
  SynthWave,
} from "./core/types.js";

// --- YAGE integration (L2) ---
export { synthBuffer } from "./buffer.js";
export { SynthPlugin } from "./SynthPlugin.js";
export type {
  SynthPluginConfig,
  SynthSoundEntry,
  SynthVariantEntry,
} from "./SynthPlugin.js";
