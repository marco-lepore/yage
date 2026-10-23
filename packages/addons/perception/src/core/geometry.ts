import type { Vec2Like } from "@yagejs/core";

export interface PerceptionGeometry {
  readonly distance: number;
  /** Absolute angle from the facing direction, in radians from 0 to π. */
  readonly angle: number;
}

/** World-pixel distance and facing offset; coincident points have angle 0. */
export function perceptionGeometry(
  origin: Vec2Like,
  facing: number,
  target: Vec2Like,
): PerceptionGeometry {
  const x = target.x - origin.x;
  const y = target.y - origin.y;
  const distance = Math.hypot(x, y);
  const difference = Math.atan2(y, x) - facing;
  return {
    distance,
    angle:
      distance === 0
        ? 0
        : Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))),
  };
}
