export { LightingPlugin } from "./LightingPlugin.js";
export { LightingSystem } from "./LightingSystem.js";
export { LightingWorld } from "./LightingWorld.js";
export { LightingWorldManager } from "./LightingWorldManager.js";

export { LightSource } from "./LightSource.js";
export type { LightSourceData, LightSourceOptions } from "./LightSource.js";

export { LightOccluder } from "./LightOccluder.js";
export type {
  LightOccluderData,
  LightOccluderOptions,
} from "./LightOccluder.js";

export {
  OverlayLightingRenderer,
  overlayLighting,
} from "./OverlayLightingRenderer.js";
export type { OverlayLightingRendererOptions } from "./OverlayLightingRenderer.js";

export { LightingWorldKey, LightingWorldManagerKey } from "./types.js";
export type {
  AmbientLightOptions,
  LightingConfig,
  LightingRenderer,
  LightingRendererContext,
  LightingRendererFactory,
  LightingRenderFrame,
  LightOccluderShape,
} from "./types.js";
