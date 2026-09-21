// Side-effect import activates `declare module "@yagejs/core"` augmentation
// that types Scene's `readonly lighting` field.
import "./scene-augmentation.js";

export { LightingPlugin } from "./LightingPlugin.js";
export { LightingSystem } from "./LightingSystem.js";
export { LightingWorld } from "./LightingWorld.js";
export { LightingWorldManager } from "./LightingWorldManager.js";
export type { LightingWorldManagerOptions } from "./LightingWorldManager.js";

export { LightSource } from "./LightSource.js";
export type { LightSourceOptions } from "./LightSource.js";

export { LightOccluder } from "./LightOccluder.js";
export type { LightOccluderOptions } from "./LightOccluder.js";

export {
  OverlayLightingRenderer,
  overlayLighting,
} from "./OverlayLightingRenderer.js";
export type { OverlayLightingRendererOptions } from "./OverlayLightingRenderer.js";

export { LightingComposite } from "./LightingComposite.js";
export type { LightingCompositeOptions } from "./LightingComposite.js";

export { LightingWorldKey, LightingWorldManagerKey } from "./types.js";
export type {
  AmbientLightOptions,
  BounceLightOptions,
  LightConeOptions,
  LightGrid,
  LightingConfig,
  LightingRenderer,
  LightingRendererContext,
  LightingRendererFactory,
  LightingRenderFrame,
  LightOccluderShape,
  SceneLightingOptions,
} from "./types.js";
