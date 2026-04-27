import { Process } from "@yagejs/core";
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
  /** Scanline contrast. Default: 0.25. */
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
 * subtle vignette. The handle's noise animator self-schedules through the
 * engine's process scheduler on attach — no caller-side `step(dt)` wiring
 * required, the noise pauses with the owning scene and time-scales with it.
 *
 * `setIntensity` scales the filter's overall contribution via `filter.alpha`
 * so all four CRT knobs (scanlines, curvature, noise, vignette) breathe
 * together — pulsing or fading touches the whole look, not just one
 * uniform. `setIntensity(0)` makes the filter invisible (the underlying
 * pass still runs; remove the effect to drop the cost).
 */
export const crt = defineEffect<CRTHandle, CRTOptions>({
  name: "yage:crt",
  factory: (options) => {
    const filter = new CRTFilter({
      curvature: options.curvature ?? 1,
      lineWidth: options.lineWidth ?? 1,
      lineContrast: options.lineContrast ?? 0.25,
      verticalLine: options.verticalLine ?? false,
      noise: options.noise ?? 0.3,
      vignetting: options.vignetting ?? 0.3,
      vignettingAlpha: options.vignettingAlpha ?? 1,
    });
    // CRTFilter's TypeScript declarations omit the inherited Filter.alpha
    // uniform; cast to unblock the assignment. At runtime every pixi Filter
    // carries `.alpha`.
    const f = filter as unknown as { alpha: number };
    const effect: Effect<CRTHandle> = {
      filter,
      getIntensity: () => f.alpha,
      setIntensity: (v) => {
        f.alpha = Math.max(0, Math.min(1, v));
      },
      onActivate: (base) => {
        // Self-schedule the noise animator. Auto-cancels on `base.remove()`,
        // pauses with scene, time-scales with scene. YAGE dt is in ms;
        // CRTFilter.time is unitless and conventionally advanced as seconds.
        base.run(
          new Process({
            update: (dt) => {
              filter.time += dt / 1000;
              filter.seed = Math.random();
            },
          }),
        );
      },
    };
    return effect;
  },
});
