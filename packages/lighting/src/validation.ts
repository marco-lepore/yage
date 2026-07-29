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
