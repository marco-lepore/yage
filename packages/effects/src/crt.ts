import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { CRTFilter } from "pixi-filters";
import type { CRTHandle } from "./handles.js";

/** Options for the {@link crt} preset. */
export interface CRTOptions {
  /** Curvature of the screen bend. Default: 1. */
  curvature?: number;
  /** Width of the scanlines. Default: 1. */
  lineWidth?: number;
  /** Scanline contrast. Drives `getIntensity`. Default: 0.25. */
  lineContrast?: number;
  /** Vertical scanlines instead of horizontal. Default: false. */
  verticalLine?: boolean;
  /** Static-noise opacity 0..1. Default: 0.3. */
  noise?: number;
  /** Vignette darkness 0..1. Default: 0.3. */
  vignetting?: number;
  /** Vignette alpha. Default: 1. */
  vignettingAlpha?: number;
}

/**
 * Authentic CRT-monitor look: scanlines, screen curvature, noise, and a
 * subtle vignette. The handle's `step(dt)` advances the noise time so the
 * grain animates frame-to-frame; without it the noise stays static.
 *
 * `getIntensity` reads `lineContrast` so the configured scanline contrast
 * is what fades — at 0 you see no scanlines, at 1 you see them at full
 * configured strength.
 */
export const crt = defineEffect<CRTHandle, CRTOptions>({
  name: "yage:crt",
  factory: (options) => {
    const baseContrast = options.lineContrast ?? 0.25;
    const filter = new CRTFilter({
      curvature: options.curvature ?? 1,
      lineWidth: options.lineWidth ?? 1,
      lineContrast: baseContrast,
      verticalLine: options.verticalLine ?? false,
      noise: options.noise ?? 0.3,
      vignetting: options.vignetting ?? 0.3,
      vignettingAlpha: options.vignettingAlpha ?? 1,
    });
    const effect: Effect<CRTHandle> = {
      filter,
      getIntensity: () => filter.lineContrast / Math.max(baseContrast, 1e-6),
      setIntensity: (v) => {
        filter.lineContrast = baseContrast * v;
      },
      buildExtras: () => ({
        step: (dt: number) => {
          filter.time += dt;
          filter.seed = Math.random();
        },
      }),
    };
    return effect;
  },
});
