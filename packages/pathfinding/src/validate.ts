/**
 * Numeric gates for game-supplied values entering a grid. Each throws a
 * plain `Error` naming the input and the constraint it violates, before
 * anything is stored, so a `NaN` never reaches a cell index, a world-pixel
 * division, or a step cost.
 */

/** Throws unless `value` is a finite number above 0. */
export function assertPositive(
  context: string,
  name: string,
  value: number,
): void {
  if (Number.isFinite(value) && value > 0) return;
  throw new Error(`${context}: ${name} must be finite and > 0, got ${value}.`);
}

/** Throws unless `value` is a whole number of cells, at least 1. */
export function assertGridExtent(
  context: string,
  name: string,
  value: number,
): void {
  if (Number.isInteger(value) && value >= 1) return;
  throw new Error(`${context}: ${name} must be an integer >= 1, got ${value}.`);
}

/** Throws unless `value` is a finite number. */
export function assertFinite(
  context: string,
  name: string,
  value: number,
): void {
  if (Number.isFinite(value)) return;
  throw new Error(`${context}: ${name} must be finite, got ${value}.`);
}

/**
 * Throws unless a `cost` callback returned a finite number. `NaN` and
 * `Infinity` both make a cell unreachable without blocking it — the A*
 * relaxation test `tentativeG < gScore` is false for either — so the cell
 * becomes an invisible wall and `findPath` returns `null` with no
 * diagnostic. Takes the pieces rather than a formatted message: this runs
 * once per expanded cell, so the string is built only on the failure path.
 */
export function assertFiniteCost(
  context: string,
  value: number,
  col: number,
  row: number,
  gid?: number,
): void {
  if (Number.isFinite(value)) return;
  const at = gid === undefined ? "" : ` for gid ${gid}`;
  throw new Error(
    `${context}: cost must return a finite number, got ${value}${at} at cell (${col}, ${row}).`,
  );
}
