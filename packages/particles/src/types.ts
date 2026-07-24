import type { RandomService } from "@yagejs/core";
import type { TextureInput } from "@yagejs/renderer";
import type { ParticleShape, ResolvedShape, ShapeConfig } from "./shapes.js";

/** A value or [min, max] range to randomize from. */
export type NumberRange = number | [min: number, max: number];

/** A property that lerps from a start value to an end value over lifetime. */
export interface Lerped {
  start: NumberRange;
  end: NumberRange;
}

/**
 * Where an emitter's particles get their look. The three options are mutually
 * exclusive: setting more than one is a type error. With none of them set, the
 * emitter renders the default `"pixel"` shape.
 */
export type TextureSource =
  // A texture, texture handle, or asset path.
  | { texture: TextureInput; textureKey?: never; shape?: never }
  // An asset key — the serializable alternative to a raw texture.
  | { texture?: never; textureKey: string; shape?: never }
  // A built-in white shape, optionally sized. Color it with `tint`.
  | {
      texture?: never;
      textureKey?: never;
      shape?: ParticleShape | ShapeConfig;
    };

/** Everything an emitter configures apart from where its texture comes from. */
export interface EmitterOptions {
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

/** Emitter configuration: a texture source plus the emission options. */
export type EmitterConfig = EmitterOptions & TextureSource;

/**
 * Where a restored emitter gets its look. Carries the same one-source rule as
 * `TextureSource`: a snapshot holds the asset key or the shape, never both. A
 * raw texture object is not serializable, so it has no arm here.
 */
export type ParticleEmitterSource =
  // Serialized from an asset key or handle.
  | { textureKey: string; shape?: never }
  // Serialized from a built-in shape, with its size filled in.
  | { textureKey?: never; shape: ResolvedShape };

/** Serializable snapshot of a ParticleEmitterComponent. */
export type ParticleEmitterData = ParticleEmitterSource & {
  maxParticles: number;
  rate: number;
  lifetime: NumberRange;
  speed: NumberRange;
  angle: NumberRange;
  scale?: NumberRange | Lerped;
  alpha?: NumberRange | Lerped;
  rotation: NumberRange;
  rotationSpeed: NumberRange;
  tint: number;
  damping: number;
  gravity?: { x: number; y: number };
  spawnOffset?: { x?: NumberRange; y?: NumberRange };
  layer: string;
};

/** Resolve a NumberRange to a concrete value. */
export function resolveRange(v: NumberRange, random: RandomService): number {
  if (typeof v === "number") return v;
  const [min, max] = v;
  return random.range(min, max);
}

/** Check if a value is a Lerped config. */
export function isLerped(v: NumberRange | Lerped): v is Lerped {
  return (
    typeof v === "object" && !Array.isArray(v) && "start" in v && "end" in v
  );
}
