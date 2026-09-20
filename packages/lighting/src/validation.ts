/** A whole turn in radians, the widest a cone can spread. */
export const FULL_TURN = Math.PI * 2;

export function assertUnit(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number from 0 to 1.`);
  }
}

export function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0.`);
  }
}

export function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${name} must be a finite number of 0 or more, got ${value}.`,
    );
  }
}

export function assertSpread(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > FULL_TURN) {
    throw new RangeError(
      `${name} must be a finite number greater than 0 and at most a whole ` +
        `turn (${FULL_TURN}), got ${value}.`,
    );
  }
}

export function assertColor(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError(
      `${name} must be an integer from 0x000000 to 0xffffff.`,
    );
  }
}

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
