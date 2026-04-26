import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { ColorMatrixFilter } from "pixi.js";
import type { HitFlashHandle } from "./handles.js";

/** Options for the {@link hitFlash} preset. */
export interface HitFlashOptions {
  /** Flash color (0xRRGGBB). Default: 0xffffff (white). */
  color?: number;
  /** Total trigger duration in ms (up + back down). Default: 120. */
  duration?: number;
  /** Peak intensity 0..1. Default: 1. */
  peak?: number;
}

/**
 * White (or any color) flash overlay — common damage-impact polish.
 * `trigger()` arms a one-shot ramp; the caller drives it forward by
 * calling `step(dt)` from their update loop. Driving the ramp through
 * `step` (rather than `requestAnimationFrame`) keeps the flash subject
 * to `scene.timeScale` and `scene.paused`, matching every other engine
 * timer.
 *
 * The flash is implemented via a `ColorMatrixFilter` whose tint additive
 * is animated through `setIntensity`, so `fadeIn`/`fadeOut` work too —
 * `trigger()` is the convenience wrapper for the full up-and-back ramp.
 */
export const hitFlash = defineEffect<HitFlashHandle, HitFlashOptions>({
  name: "yage:hitFlash",
  factory: (options) => {
    const opts: Required<HitFlashOptions> = {
      color: options.color ?? 0xffffff,
      duration: options.duration ?? 120,
      peak: options.peak ?? 1,
    };
    let intensity = 0;
    let triggerElapsed = 0;
    let triggerActive = false;
    let activeColor = opts.color;
    const filter = new ColorMatrixFilter();
    const apply = (): void => {
      // ColorMatrixFilter uses a 5x4 matrix [r, g, b, _, additive, ...].
      // Add a flat tint scaled by intensity via the additive column
      // (indexes 4, 9, 14).
      const r = ((activeColor >> 16) & 0xff) / 255;
      const g = ((activeColor >> 8) & 0xff) / 255;
      const b = (activeColor & 0xff) / 255;
      const m = filter.matrix;
      m[4] = r * intensity;
      m[9] = g * intensity;
      m[14] = b * intensity;
      filter.matrix = m;
    };
    const effect: Effect<HitFlashHandle> = {
      filter,
      getIntensity: () => intensity,
      setIntensity: (v) => {
        intensity = v;
        apply();
      },
      buildExtras: () => ({
        trigger: () => {
          triggerElapsed = 0;
          triggerActive = true;
        },
        step: (dt: number) => {
          if (!triggerActive) return;
          triggerElapsed += dt;
          const t = triggerElapsed / opts.duration;
          if (t >= 1) {
            triggerActive = false;
            intensity = 0;
            apply();
            return;
          }
          // Triangle wave: ramp up over first half, down over second.
          intensity = (t < 0.5 ? t * 2 : (1 - t) * 2) * opts.peak;
          apply();
        },
        setColor: (color: number) => {
          activeColor = color;
          apply();
        },
      }),
    };
    return effect;
  },
});
