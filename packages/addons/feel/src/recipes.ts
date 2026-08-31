import type { EasingFunction } from "@yagejs/core";
import { implosion, zoomBlur } from "@yagejs/effects";
import type { EffectsHost } from "@yagejs/renderer";
import { feelParallel } from "./core/node.js";
import type { FeelNode } from "./core/types.js";
import { feelEffect } from "./adapters/renderer.js";

export interface VoidCollapseOptions {
  /** Effect host for both renderer passes. */
  host: EffectsHost;
  /** Center in the effect host's local coordinates. Omit for the host center. */
  center?: { x: number; y: number };
  /** Radius in host-local pixels. Default: 180. */
  radius?: number;
  /** Inward displacement strength. Default: 0.8. */
  strength?: number;
  /** Center darkening from 0 to 1. Default: 0.9. */
  darkness?: number;
  /** Rotation applied near the center, in radians. Default: 0.35. */
  swirl?: number;
  /** Inward zoom-blur strength. Default: -0.14. */
  zoomStrength?: number;
  /** Total pulse duration. Default: 0.6. */
  duration?: number;
  /** Normalized time of maximum collapse. Default: 0.65. */
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

/**
 * Ready-made inward distortion and zoom-blur cue. The recipe does not add a
 * burst, particles, camera movement, sound, or gameplay consequences.
 */
export function voidCollapse(options: VoidCollapseOptions): FeelNode {
  const timing = {
    duration: options.duration ?? 0.6,
    peakAt: options.peakAt ?? 0.65,
    ...(options.attackEasing === undefined
      ? {}
      : { attackEasing: options.attackEasing }),
    ...(options.releaseEasing === undefined
      ? {}
      : { releaseEasing: options.releaseEasing }),
  };
  return feelParallel(
    feelEffect(
      options.host,
      implosion({
        ...(options.center === undefined ? {} : { center: options.center }),
        radius: options.radius ?? 180,
        strength: options.strength ?? 0.8,
        darkness: options.darkness ?? 0.9,
        swirl: options.swirl ?? 0.35,
      }),
      timing,
    ),
    feelEffect(
      options.host,
      zoomBlur({
        ...(options.center === undefined ? {} : { center: options.center }),
        radius: options.radius ?? 180,
        strength: options.zoomStrength ?? -0.14,
      }),
      timing,
    ),
  );
}
