import { FillGradient } from "pixi.js";
import type { GradientFill } from "./public-types.js";

/** A single color stop along a gradient, with yage's numeric color + alpha pair. */
export interface GradientStop {
  /** Position along the gradient, 0 (start) to 1 (end). */
  offset: number;
  /** Color as 0xRRGGBB. */
  color: number;
  /** Opacity 0-1. Default: 1. */
  alpha?: number;
}

/**
 * How gradient coordinates are interpreted.
 *
 * - `"local"` — `start`/`end` (or `innerCenter`/`outerCenter`) are in the 0-1
 *   space of the shape the gradient fills. A vertical gradient from {0,0} to
 *   {0,1} scales to cover any rect it's applied to. This is the default.
 * - `"global"` — coordinates are absolute world/screen pixels. Useful when
 *   multiple shapes should share a single gradient "ruler."
 */
export type GradientSpace = "local" | "global";

/** Options for {@link linearGradient}. */
export interface LinearGradientOptions {
  stops: readonly GradientStop[];
  /**
   * Shorthand for common orientations. Ignored if {@link start} / {@link end}
   * are provided.
   */
  axis?: "horizontal" | "vertical";
  /** Explicit start point. Overrides `axis`. */
  start?: { x: number; y: number };
  /** Explicit end point. Overrides `axis`. */
  end?: { x: number; y: number };
  /** Coordinate space for `start`/`end`. Default: `"local"`. */
  space?: GradientSpace;
}

/** Options for {@link radialGradient}. */
export interface RadialGradientOptions {
  stops: readonly GradientStop[];
  /** Center of the gradient. Default: `{ x: 0.5, y: 0.5 }` in local space. */
  center?: { x: number; y: number };
  /** Radius of the inner (start) circle. Default: `0`. */
  innerRadius?: number;
  /** Radius of the outer (end) circle. Default: `0.5` in local space. */
  outerRadius?: number;
  /** Coordinate space for centers and radii. Default: `"local"`. */
  space?: GradientSpace;
}

function stopToCss(stop: GradientStop): { offset: number; color: string } {
  const r = (stop.color >> 16) & 0xff;
  const g = (stop.color >> 8) & 0xff;
  const b = stop.color & 0xff;
  const a = stop.alpha ?? 1;
  return { offset: stop.offset, color: `rgba(${r},${g},${b},${a})` };
}

/**
 * Create a linear gradient fill usable with `GraphicsComponent` draws
 * (`g.rect(...).fill(myGradient)`).
 *
 * Uses yage-style numeric colors with optional alpha per stop, and a simple
 * axis shorthand for the common vertical/horizontal cases.
 *
 * Returns a `GradientFill` (pixi `FillGradient` under the hood). Call
 * `.destroy()` when you're done with it to release the backing texture —
 * components typically do this in `onRemove()`.
 */
export function linearGradient(options: LinearGradientOptions): GradientFill {
  const axis = options.axis ?? "vertical";
  const start = options.start ?? { x: 0, y: 0 };
  const end =
    options.end ??
    (axis === "horizontal" ? { x: 1, y: 0 } : { x: 0, y: 1 });
  return new FillGradient({
    type: "linear",
    start,
    end,
    colorStops: options.stops.map(stopToCss),
    textureSpace: options.space ?? "local",
  });
}

/**
 * Create a radial gradient fill. In `"local"` space (the default), centers
 * are in the 0-1 range of the filled shape's bounds.
 */
export function radialGradient(options: RadialGradientOptions): GradientFill {
  const center = options.center ?? { x: 0.5, y: 0.5 };
  return new FillGradient({
    type: "radial",
    center,
    innerRadius: options.innerRadius ?? 0,
    outerRadius: options.outerRadius ?? 0.5,
    colorStops: options.stops.map(stopToCss),
    textureSpace: options.space ?? "local",
  });
}
