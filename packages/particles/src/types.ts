import type { RandomService } from "@yagejs/core";
import type { BlendMode, TextureInput } from "@yagejs/renderer";
import type { ParticleShape, ShapeConfig } from "./shapes.js";

/** A value or [min, max] range to randomize from. */
export type NumberRange = number | [min: number, max: number];

/** A property that lerps from a start value to an end value over lifetime. */
export interface Lerped {
  start: NumberRange;
  end: NumberRange;
}

/**
 * Where an emitter's particles get their look. The two options are mutually
 * exclusive: setting both is a type error. With neither set, the emitter
 * renders the default `"pixel"` shape.
 */
export type TextureSource =
  // A texture, texture handle, or asset key.
  | { texture: TextureInput; shape?: never }
  // A built-in white shape, optionally sized. Color it with `tint`.
  | {
      texture?: never;
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
  /**
   * How the whole particle container's pixels combine with what is drawn
   * beneath it — `"add"` for fire, sparks, and magic. Unset, the container
   * inherits its render layer's blend mode, which is `"normal"` unless the
   * game set one on the layer. See {@link BlendMode} for the modes that need
   * `import "pixi.js/advanced-blend-modes"`.
   */
  blendMode?: BlendMode;
  /** Gravity in px/s². Default: none. */
  gravity?: { x: number; y: number };
  /** Velocity damping per second (0-1). Default: 0. */
  damping?: number;
  /**
   * Random offset from the emitter's origin at spawn time, in either form:
   * a rectangle (`x`/`y` ranges) or a ring (`radius`, with an optional
   * `angle` arc that defaults to the full circle). Setting members of both
   * forms is a type error.
   */
  spawnOffset?:
    | { x?: NumberRange; y?: NumberRange; radius?: never; angle?: never }
    | { radius: NumberRange; angle?: NumberRange; x?: never; y?: never };
  /**
   * Speed in px/s along the direction from the emitter's origin to the
   * particle's spawn offset. Negative moves inward. Adds to the velocity
   * `speed` and `angle` produce. Needs a `spawnOffset`.
   */
  radialSpeed?: NumberRange;
  /**
   * `"world"` (default): particles keep the screen position they were spawned
   * at, so moving the emitter afterwards does not drag them along.
   * `"local"`: particles follow the emitter's position. Position only — the
   * emitter's rotation and scale are not applied.
   */
  simulationSpace?: "world" | "local";
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Emitter configuration: a texture source plus the emission options. */
export type EmitterConfig = EmitterOptions & TextureSource;

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
