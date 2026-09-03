import type { TextureInput } from "@yagejs/renderer";
import type { ShapeConfig } from "./shapes.js";
import type { EmitterConfig, TextureSource } from "./types.js";

/**
 * Where a preset gets its look: the caller's texture when one is given, its own
 * built-in shape otherwise. The shape carries the effect's absolute particle
 * size, which leaves each preset's `scale` as animation and variation centred
 * on 1 — so the same values also read correctly against a caller's texture,
 * animating it at its natural size.
 */
function source(
  textureOrKey: TextureInput | undefined,
  shape: ShapeConfig,
): TextureSource {
  if (textureOrKey === undefined) return { shape };
  return { texture: textureOrKey };
}

/**
 * Preset emitter configurations. Each works with no arguments, rendering a
 * built-in shape; pass a texture or asset key to use your own art instead.
 *
 * The returned config already carries a texture source, so overriding the
 * source by spreading is a type error — pass it as the argument. Spreading to
 * override anything else (`rate`, `tint`, `lifetime`, ...) works.
 */
export const ParticlePresets = {
  /** Upward fire effect with fading and shrinking. */
  fire(textureOrKey?: TextureInput): EmitterConfig {
    return {
      ...source(textureOrKey, { type: "softCircle", size: 32 }),
      maxParticles: 200,
      rate: 60,
      lifetime: [0.4, 0.8],
      speed: [90, 180],
      angle: [-Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3],
      scale: { start: [0.7, 1.1], end: [0.2, 0.35] },
      alpha: { start: 1, end: 0 },
      tint: 0xff6600,
      spawnOffset: { x: [-5, 5] },
    };
  },

  /** Slow-rising smoke effect. */
  smoke(textureOrKey?: TextureInput): EmitterConfig {
    return {
      ...source(textureOrKey, { type: "softCircle", size: 40 }),
      maxParticles: 100,
      rate: 18,
      lifetime: [1.2, 2.4],
      speed: [50, 110],
      angle: [-Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4],
      scale: { start: [0.4, 0.6], end: [1.1, 1.5] },
      alpha: { start: [0.4, 0.6], end: 0 },
      tint: 0x888888,
      damping: 0.3,
      spawnOffset: { x: [-8, 8] },
    };
  },

  /** Fast directional sparks. */
  sparks(textureOrKey?: TextureInput): EmitterConfig {
    return {
      ...source(textureOrKey, { type: "line", size: [10, 3] }),
      maxParticles: 150,
      rate: 60,
      lifetime: [0.2, 0.5],
      speed: [200, 400],
      angle: [0, Math.PI * 2],
      scale: [0.8, 1.2],
      alpha: { start: 1, end: 0 },
      tint: 0xffcc00,
      gravity: { x: 0, y: 300 },
      rotation: [0, Math.PI * 2],
      rotationSpeed: [-5, 5],
    };
  },

  /** Downward rain drops. */
  rain(textureOrKey?: TextureInput): EmitterConfig {
    return {
      ...source(textureOrKey, { type: "line", size: [2, 20] }),
      maxParticles: 300,
      rate: 80,
      lifetime: [0.5, 1.0],
      speed: [300, 500],
      angle: [Math.PI / 2 - 0.1, Math.PI / 2 + 0.1],
      scale: [0.8, 1.2],
      alpha: [0.5, 0.8],
      tint: 0xaaccff,
      spawnOffset: { x: [-400, 400], y: [-50, 0] },
    };
  },
} as const;
