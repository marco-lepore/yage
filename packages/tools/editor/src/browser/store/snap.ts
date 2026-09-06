import type { EditorPoint } from "./types.js";

/**
 * World units between grid lines with nothing stored.
 *
 * A power of two, so it divides the 16, 32, 64, and 128 pixel sizes 2D sprites
 * and tiles come in, and two placements a cell apart sit flush. It is also
 * wide enough on screen at zoom 1 that the grid draws the lattice itself
 * rather than a multiple of it, so the first drag lands on a line that is
 * visible.
 */
export const DEFAULT_STEP = 32;

/**
 * How coarse or fine the lattice can be. One world unit is one pixel, so a
 * sub-pixel lattice is not a placement grid; the ceiling stops a typo from
 * making the grid vanish.
 */
export const MIN_STEP = 1;
export const MAX_STEP = 10_000;

/** The step brought inside the bounds. A step that is not a number resets. */
export function clampStep(step: number): number {
  if (Number.isNaN(step)) return DEFAULT_STEP;
  return Math.min(MAX_STEP, Math.max(MIN_STEP, step));
}

/** The value rounded to the nearest multiple of `step`. */
export function snappedValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** The point rounded to the nearest lattice point. */
export function snappedPoint(point: EditorPoint, step: number): EditorPoint {
  return { x: snappedValue(point.x, step), y: snappedValue(point.y, step) };
}

/** The angle rounded to a whole number of `step` radians. */
export function snappedAngle(radians: number, step: number): number {
  return Math.round(radians / step) * step;
}

/**
 * The smallest of `1, 2, 5, 10, 20, 50, …` that is at least `least`, and how
 * many of it make a major line.
 *
 * Never below 1: the lattice is the finest thing anything draws or lands on,
 * so a step already wide enough on screen is drawn as it stands.
 */
export function latticeMultiple(least: number): {
  times: number;
  span: number;
} {
  if (!(least > 1)) return { times: 1, span: 5 };
  const decade = 10 ** Math.floor(Math.log10(least));
  const within = least / decade;
  const mantissa = within <= 1 ? 1 : within <= 2 ? 2 : within <= 5 ? 5 : 10;
  return { times: mantissa * decade, span: mantissa === 5 ? 4 : 5 };
}
