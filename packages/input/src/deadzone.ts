import { Vec2 } from "@yagejs/core";

/**
 * Radial dead-zone with magnitude rescale: inside `deadzone` the result is
 * `Vec2.ZERO`; outside, direction is preserved and the magnitude ramps from
 * 0 at the dead-zone edge to 1 at full deflection (clamped). This is the
 * response curve `getStick` applies to pad hardware — exported so synthetic
 * stick sources (virtual/touch controls) can shape their own values with
 * the exact same curve instead of re-deriving it.
 *
 * `deadzone` must be in [0, 1).
 */
export function applyRadialDeadzone(
  x: number,
  y: number,
  deadzone: number,
): Vec2 {
  const mag = Math.hypot(x, y);
  if (mag === 0 || mag < deadzone) return Vec2.ZERO;
  const adjusted = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return new Vec2((x / mag) * adjusted, (y / mag) * adjusted);
}
