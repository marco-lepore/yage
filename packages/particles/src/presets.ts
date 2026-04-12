import type { TextureInput } from "@yagejs/renderer";
import type { EmitterConfig } from "./types.js";

function textureFields(
  textureOrKey: TextureInput,
): Pick<EmitterConfig, "texture" | "textureKey"> {
  return typeof textureOrKey === "string"
    ? { textureKey: textureOrKey }
    : { texture: textureOrKey };
}

/** Preset emitter configurations. */
export const ParticlePresets = {
  /** Upward fire effect with fading and shrinking. */
  fire(textureOrKey: TextureInput): EmitterConfig {
    return {
      ...textureFields(textureOrKey),
      maxParticles: 200,
      rate: 40,
      lifetime: [0.4, 0.8],
      speed: [80, 160],
      angle: [-Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3],
      scale: { start: [0.6, 1.0], end: [0.1, 0.2] },
      alpha: { start: 1, end: 0 },
      tint: 0xff6600,
      spawnOffset: { x: [-5, 5] },
    };
  },

  /** Slow-rising smoke effect. */
  smoke(textureOrKey: TextureInput): EmitterConfig {
    return {
      ...textureFields(textureOrKey),
      maxParticles: 100,
      rate: 15,
      lifetime: [1.0, 2.0],
      speed: [20, 50],
      angle: [-Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4],
      scale: { start: [0.3, 0.5], end: [1.0, 1.5] },
      alpha: { start: [0.4, 0.6], end: 0 },
      tint: 0x888888,
      damping: 0.3,
      spawnOffset: { x: [-8, 8] },
    };
  },

  /** Fast directional sparks. */
  sparks(textureOrKey: TextureInput): EmitterConfig {
    return {
      ...textureFields(textureOrKey),
      maxParticles: 150,
      rate: 30,
      lifetime: [0.2, 0.5],
      speed: [200, 400],
      angle: [0, Math.PI * 2],
      scale: [0.2, 0.5],
      alpha: { start: 1, end: 0 },
      tint: 0xffcc00,
      gravity: { x: 0, y: 300 },
      rotationSpeed: [-5, 5],
    };
  },

  /** Downward rain drops. */
  rain(textureOrKey: TextureInput): EmitterConfig {
    return {
      ...textureFields(textureOrKey),
      maxParticles: 300,
      rate: 80,
      lifetime: [0.5, 1.0],
      speed: [300, 500],
      angle: [Math.PI / 2 - 0.1, Math.PI / 2 + 0.1],
      scale: [0.3, 0.6],
      alpha: [0.5, 0.8],
      tint: 0xaaccff,
      spawnOffset: { x: [-400, 400], y: [-50, 0] },
    };
  },
} as const;
