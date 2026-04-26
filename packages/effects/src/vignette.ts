import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { CRTFilter } from "pixi-filters";
import type { VignetteHandle } from "./handles.js";

/** Options for the {@link vignette} preset. */
export interface VignetteOptions {
  /** Vignette radius — smaller = tighter dark ring. Default: 0.4. */
  radius?: number;
  /** Vignette darkness 0..1. Drives `getIntensity`. Default: 0.6. */
  alpha?: number;
  /** Edge softness 0..1. Default: 0.3. */
  blur?: number;
}

/**
 * Subtle edge darkening. Implemented by reusing pixi-filters' CRTFilter
 * with all CRT-specific features (scanlines, curvature, noise) zeroed,
 * leaving only the vignette controls active. Cheaper to ship than a custom
 * shader and round-trips through save/load like any other preset.
 */
export const vignette = defineEffect<VignetteHandle, VignetteOptions>({
  name: "yage:vignette",
  factory: (options) => {
    let baseAlpha = options.alpha ?? 0.6;
    const filter = new CRTFilter({
      curvature: 0,
      lineWidth: 0,
      lineContrast: 0,
      noise: 0,
      vignetting: options.radius ?? 0.4,
      vignettingAlpha: baseAlpha,
      vignettingBlur: options.blur ?? 0.3,
    });
    const effect: Effect<VignetteHandle> = {
      filter,
      getIntensity: () =>
        filter.vignettingAlpha / Math.max(baseAlpha, 1e-6),
      setIntensity: (v) => {
        filter.vignettingAlpha = baseAlpha * v;
      },
      buildExtras: () => ({
        setStrength: (value: number) => {
          baseAlpha = value;
          filter.vignettingAlpha = value;
        },
      }),
    };
    return effect;
  },
});
