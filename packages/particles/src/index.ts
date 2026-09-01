// Plugin
export { ParticlesPlugin } from "./ParticlesPlugin.js";

// Component
export { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";
export type { ParticleEmissionHandle } from "./ParticleEmitterComponent.js";

// System
export { ParticleSystem } from "./ParticleSystem.js";

// Pool
export { ParticlePool } from "./ParticlePool.js";

// Presets
export { ParticlePresets } from "./presets.js";

// Built-in shapes
export { shapeTexture } from "./shapes.js";
export type {
  ParticleShape,
  ShapeConfig,
  ShapeSize,
  ResolvedShape,
} from "./shapes.js";

// Types
export { resolveRange, isLerped } from "./types.js";
export type {
  NumberRange,
  Lerped,
  EmitterConfig,
  EmitterOptions,
  TextureSource,
} from "./types.js";
