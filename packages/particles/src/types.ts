import type { Texture } from "pixi.js";

/** A value or [min, max] range to randomize from. */
export type NumberRange = number | [min: number, max: number];

/** A property that lerps from a start value to an end value over lifetime. */
export interface Lerped {
  start: NumberRange;
  end: NumberRange;
}

/** Emitter configuration. */
export interface EmitterConfig {
  /** The texture for all particles in this emitter. */
  texture: Texture;
  /** Maximum number of live particles. Default: 100. */
  maxParticles?: number;
  /** Particles per second for continuous emission. Default: 10. */
  rate?: number;
  /** Particle lifetime in seconds. */
  lifetime: NumberRange;
  /** Initial speed in px/s. Default: 0. */
  speed?: NumberRange;
  /** Emission direction in radians. Default: 0. */
  angle?: NumberRange;
  /** Uniform scale (or lerped). Default: 1. */
  scale?: NumberRange | Lerped;
  /** Alpha/opacity (or lerped). Default: 1. */
  alpha?: NumberRange | Lerped;
  /** Initial rotation in radians. Default: 0. */
  rotation?: NumberRange;
  /** Rotation speed in rad/s. Default: 0. */
  rotationSpeed?: NumberRange;
  /** Tint color. Default: 0xffffff. */
  tint?: number;
  /** Gravity in px/s². Default: none. */
  gravity?: { x: number; y: number };
  /** Velocity damping per second (0-1). Default: 0. */
  damping?: number;
  /** Random offset from entity position at spawn time. */
  spawnOffset?: {
    x?: NumberRange;
    y?: NumberRange;
  };
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Resolve a NumberRange to a concrete value. */
export function resolveRange(v: NumberRange): number {
  if (typeof v === "number") return v;
  const [min, max] = v;
  return min + Math.random() * (max - min);
}

/** Check if a value is a Lerped config. */
export function isLerped(v: NumberRange | Lerped): v is Lerped {
  return (
    typeof v === "object" &&
    !Array.isArray(v) &&
    "start" in v &&
    "end" in v
  );
}
