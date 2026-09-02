/**
 * Numeric gates for game-supplied values entering the simulation. Each
 * throws a plain `Error` naming the input and the constraint it violates,
 * before anything is stored, so a `NaN` never reaches a body or collider.
 */

/**
 * Throws unless `value` is `undefined` (optional field), or a finite number
 * that is at least `min` when a minimum is given.
 */
export function assertFiniteNumber(
  context: string,
  name: string,
  value: number | undefined,
  min?: number,
): void {
  if (value === undefined) return;
  const belowMin = min !== undefined && value < min;
  if (Number.isFinite(value) && !belowMin) return;
  const constraint =
    min === undefined ? "must be finite" : `must be finite and >= ${min}`;
  throw new Error(`${context}: ${name} ${constraint}, got ${value}.`);
}

/** Throws unless `pixelsPerMeter` is `undefined` or a finite number above 0. */
export function assertPixelsPerMeter(
  context: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (Number.isFinite(value) && value > 0) return;
  throw new Error(
    `${context}: pixelsPerMeter must be finite and > 0, got ${value}.`,
  );
}
