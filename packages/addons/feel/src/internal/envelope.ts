import { easeOutQuad, type EasingFunction } from "@yagejs/core";

export function feelPunchAmount(
  progress: number,
  peakAt = 0.25,
  attack: EasingFunction = easeOutQuad,
  release: EasingFunction = easeOutQuad,
): number {
  validateFeelPeakAt(peakAt);
  if (peakAt <= 0) return 1 - release(progress);
  if (peakAt >= 1) return attack(progress);
  if (progress <= peakAt) return attack(progress / peakAt);
  return 1 - release((progress - peakAt) / (1 - peakAt));
}

export function validateFeelPeakAt(peakAt = 0.25): void {
  if (!Number.isFinite(peakAt) || peakAt < 0 || peakAt > 1) {
    throw new Error(`Feel effect: peakAt must be between 0 and 1.`);
  }
}
