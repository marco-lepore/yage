import type { Vec2Like } from "@yagejs/core";

export interface PerceptionGeometry {
  readonly distance: number;
  /** Absolute angle from the observer's forward direction, in radians. */
  readonly angle: number;
}

/** World-pixel geometry; coincident points have angle 0. Undefined for non-finite inputs. */
export function perceptionGeometry(
  origin: Vec2Like,
  rotation: number,
  target: Vec2Like,
): PerceptionGeometry {
  const x = target.x - origin.x;
  const y = target.y - origin.y;
  const distance = Math.hypot(x, y);
  const difference = Math.atan2(y, x) - (rotation % (Math.PI * 2));
  return {
    distance,
    angle:
      distance === 0
        ? 0
        : Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))),
  };
}
