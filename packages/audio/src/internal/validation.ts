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
