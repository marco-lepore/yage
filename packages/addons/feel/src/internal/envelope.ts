import { easeOutQuad, type EasingFunction } from "@yagejs/core";
import type { FeelEffectContext, FeelPulseTiming } from "../core/types.js";
import { invokeFeelEasing } from "./easing.js";

export interface ResolvedFeelPulseTiming {
  readonly duration: number;
  readonly peakAt: number;
  readonly attackEasing: EasingFunction;
  readonly releaseEasing: EasingFunction;
}

interface FeelPulseDefaults {
  readonly duration: number;
  readonly peakAt?: number;
  readonly attackEasing?: EasingFunction;
  readonly releaseEasing?: EasingFunction;
  readonly positiveDuration?: boolean;
}

export function resolveFeelPulseTiming(
  builder: string,
  timing: FeelPulseTiming,
  defaults: FeelPulseDefaults,
): ResolvedFeelPulseTiming {
  const duration = timing.duration ?? defaults.duration;
  const peakAt = timing.peakAt ?? defaults.peakAt ?? 0.25;
  if (
    !Number.isFinite(duration) ||
    (defaults.positiveDuration ? duration <= 0 : duration < 0)
  ) {
    const constraint = defaults.positiveDuration ? "> 0" : ">= 0";
    throw new Error(
      `${builder}: duration must be a finite number ${constraint}, got ${duration}.`,
    );
  }
  validateFeelPeakAt(builder, peakAt);
  return {
    duration,
    peakAt,
    attackEasing: timing.attackEasing ?? defaults.attackEasing ?? easeOutQuad,
    releaseEasing:
      timing.releaseEasing ?? defaults.releaseEasing ?? easeOutQuad,
  };
}

export function feelPunchAmount(
  context: FeelEffectContext,
  builder: string,
  progress: number,
  timing: ResolvedFeelPulseTiming,
  ...multipliers: number[]
): number {
  if (timing.peakAt <= 0) {
    return invokePulseEasing(
      context,
      builder,
      "release",
      timing.releaseEasing,
      progress,
      true,
      multipliers,
    );
  }
  if (timing.peakAt >= 1) {
    return invokePulseEasing(
      context,
      builder,
      "attack",
      timing.attackEasing,
      progress,
      false,
      multipliers,
    );
  }
  if (progress <= timing.peakAt) {
    return invokePulseEasing(
      context,
      builder,
      "attack",
      timing.attackEasing,
      progress / timing.peakAt,
      false,
      multipliers,
    );
  }
  return invokePulseEasing(
    context,
    builder,
    "release",
    timing.releaseEasing,
    (progress - timing.peakAt) / (1 - timing.peakAt),
    true,
    multipliers,
  );
}

export function invokePulseEasing(
  context: FeelEffectContext,
  builder: string,
  phase: "attack" | "release",
  easing: EasingFunction,
  progress: number,
  invert = false,
  multipliers: readonly number[] = [],
): number {
  return invokeFeelEasing(
    context,
    easing,
    progress,
    `${builder} ${phase} easing`,
    `${builder}: ${phase}Easing`,
    (eased) => {
      let amount = invert ? 1 - eased : eased;
      for (const multiplier of multipliers) amount *= multiplier;
      return amount;
    },
  );
}

export function validateFeelPeakAt(builder: string, peakAt: number): void {
  if (!Number.isFinite(peakAt) || peakAt < 0 || peakAt > 1) {
    throw new Error(
      `${builder}: peakAt must be a finite number between 0 and 1, got ${peakAt}.`,
    );
  }
}
