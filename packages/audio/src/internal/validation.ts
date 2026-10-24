export function assertVolume(context: string, volume: number): void {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(
      `${context}: volume must be a finite number from 0 to 1, got ${volume}.`,
    );
  }
}

export function assertFadeDuration(context: string, duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `${context}: duration must be a finite number > 0 in seconds, got ${duration}.`,
    );
  }
}

export function assertTime(context: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${context}: must be finite and >= 0, got ${value}.`);
}
export function assertPositive(context: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${context}: must be finite and > 0, got ${value}.`);
}
export function assertSpeed(context: string, value: number): void {
  const nativeValue = Math.fround(value);
  if (!Number.isFinite(nativeValue) || nativeValue <= 0)
    throw new Error(
      `${context}: speed must be positive and finite at Web Audio precision, got ${value}.`,
    );
}
export function assertPan(context: string, value: number): void {
  if (!Number.isFinite(value) || value < -1 || value > 1)
    throw new Error(
      `${context}: pan must be finite and from -1 to 1, got ${value}.`,
    );
}
