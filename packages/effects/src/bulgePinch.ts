import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { BulgePinchFilter } from "pixi-filters";
import type { BulgePinchHandle } from "./handles.js";

/** Options for the {@link bulgePinch} preset. */
export interface BulgePinchOptions {
  /** Distortion strength: -1 strong pinch, 0 none, +1 strong bulge. Drives `getIntensity`. Default: 1. */
  strength?: number;
  /** Distortion radius in pixels. Default: 100. */
  radius?: number;
  /**
   * Center as normalized screen coords (0..1) — `{ x: 0.5, y: 0.5 }` is the
   * middle of the host. Default: `{ x: 0.5, y: 0.5 }`.
   */
  center?: { x: number; y: number };
}

/**
 * Lens-distortion bulge or pinch via pixi-filters' BulgePinchFilter. Useful
 * for fish-eye flourishes, telescope reveals, or stomach-punch hits.
 *
 * `setIntensity` scales the configured `strength` from 0 (no distortion) to
 * its full magnitude — preserving the sign, so a pinch-configured filter
 * fades from flat → pinch (not flat → bulge → pinch).
 *
 * `setStrength` rebases the full value while preserving the current
 * intensity ratio so a fade in flight keeps animating against the new
 * ceiling instead of snapping back to 1.
 */
export const bulgePinch = defineEffect<BulgePinchHandle, BulgePinchOptions>({
  name: "yage:bulgePinch",
  factory: (options) => {
    let baseStrength = options.strength ?? 1;
    const center = options.center ?? { x: 0.5, y: 0.5 };
    const filter = new BulgePinchFilter({
      strength: baseStrength,
      radius: options.radius ?? 100,
      center,
    });
    const effect: Effect<BulgePinchHandle> = {
      filter,
      // Magnitude-based ratio: pinch (negative strength) and bulge (positive)
      // both report intensity in [0, 1] without sign flips.
      getIntensity: () =>
        Math.abs(filter.strength) / Math.max(Math.abs(baseStrength), 1e-6),
      setIntensity: (v) => {
        filter.strength = baseStrength * v;
      },
      buildExtras: () => ({
        setStrength: (value: number) => {
          // Preserve magnitude ratio; rebase keeps current intensity AND
          // adopts the new sign (so toggling pinch ↔ bulge actually flips
          // direction instead of stalling at the previous polarity).
          const ratio =
            Math.abs(filter.strength) / Math.max(Math.abs(baseStrength), 1e-6);
          baseStrength = value;
          filter.strength = value * ratio;
        },
        setCenter: (x: number, y: number) => {
          filter.center = { x, y };
        },
        setRadius: (value: number) => {
          filter.radius = value;
        },
      }),
    };
    return effect;
  },
});
