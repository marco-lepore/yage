import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";
import type { EasingFunction } from "./types.js";

/** Types that can be interpolated by keyframe tracks. */
export type Interpolatable = number | Vec2Like;

/**
 * Interpolate between two values of the same type.
 * - `number` → linear interpolation
 * - `Vec2Like` → component-wise lerp, returns `Vec2`
 */
export function interpolate<T extends Interpolatable>(
  from: T,
  to: T,
  t: number,
  easing?: EasingFunction,
): T {
  const e = easing ? easing(t) : t;
  if (typeof from === "number") {
    return (from + ((to as number) - from) * e) as T;
  }
  const a = from as Vec2Like;
  const b = to as Vec2Like;
  return new Vec2(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e) as unknown as T;
}
