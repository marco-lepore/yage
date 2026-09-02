/**
 * Numeric gates for game-supplied values entering camera state. Each throws a
 * plain `Error` naming the input and the constraint it violates, before the
 * value is stored — a `NaN` written into position, zoom, or an animation
 * clock never recovers, since every later comparison against it is false.
 * @internal
 */

/** Throws unless `value` is a finite number that is at least `min`. */
export function assertFiniteNumber(
  context: string,
  name: string,
  value: number,
  min?: number,
): void {
  const belowMin = min !== undefined && value < min;
  if (Number.isFinite(value) && !belowMin) return;
  const constraint =
    min === undefined ? "must be finite" : `must be finite and >= ${min}`;
  throw new Error(`${context}: ${name} ${constraint}, got ${value}.`);
}

/** Throws unless `value` is a finite number above 0. */
export function assertPositiveNumber(
  context: string,
  name: string,
  value: number,
): void {
  if (Number.isFinite(value) && value > 0) return;
  throw new Error(`${context}: ${name} must be finite and > 0, got ${value}.`);
}
