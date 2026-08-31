/**
 * Input validation shared by the effect presets.
 *
 * A non-finite number written into filter state is unrecoverable: `NaN` fails
 * every comparison a clamp would rely on, and once it reaches a uniform the
 * host renders undefined output with nothing pointing back at the call that
 * caused it. Every public numeric entry point — preset options and handle
 * setters alike — runs through these helpers so the throw names the effect and
 * the offending input instead of surfacing later as a blank sprite.
 *
 * @internal
 */

/** Reject a non-finite number. */
export function validateFinite(
  effect: string,
  label: string,
  value: number,
): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${effect}: ${label} must be finite, got ${value}.`);
  }
  return value;
}

/** Reject a non-finite number or one below `min`. */
export function validateMinimum(
  effect: string,
  label: string,
  value: number,
  min: number,
): number {
  validateFinite(effect, label, value);
  if (value < min) {
    throw new Error(`${effect}: ${label} must be >= ${min}, got ${value}.`);
  }
  return value;
}

/** Reject a non-finite number or one outside `min`..`max`. */
export function validateRange(
  effect: string,
  label: string,
  value: number,
  min: number,
  max: number,
): number {
  validateFinite(effect, label, value);
  if (value < min || value > max) {
    throw new Error(
      `${effect}: ${label} must be between ${min} and ${max}, got ${value}.`,
    );
  }
  return value;
}

/** Reject a non-integer, or an integer below `min`. */
export function validateInteger(
  effect: string,
  label: string,
  value: number,
  min: number,
): number {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(
      `${effect}: ${label} must be an integer >= ${min}, got ${value}.`,
    );
  }
  return value;
}

/** Reject a point whose `x` or `y` is non-finite. */
export function validatePoint<T extends { x: number; y: number }>(
  effect: string,
  label: string,
  point: T,
): T {
  validateFinite(effect, `${label}.x`, point.x);
  validateFinite(effect, `${label}.y`, point.y);
  return point;
}
