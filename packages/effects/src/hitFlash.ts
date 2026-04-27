import { Process } from "@yagejs/core";
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
 * White (or any color) flash overlay — common damage-impact polish. The
 * `trigger()` ramp drives itself through the engine's process scheduler:
 * pauses with the owning scene, time-scales with it, auto-cancels on
 * `remove()`. No caller-side `step(dt)` wiring required.
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
      buildExtras: (base) => {
        let inFlight: Process | undefined;
        return {
          trigger: () => {
            // Cancel any in-flight trigger before arming a new one so
            // overlapping triggers don't compound.
            inFlight?.cancel();
            inFlight = base.run(
              new Process({
                duration: opts.duration,
                update: (_dt, elapsed) => {
                  const t = elapsed / opts.duration;
                  // Triangle wave: up over first half, down over second.
                  intensity = (t < 0.5 ? t * 2 : (1 - t) * 2) * opts.peak;
                  apply();
                },
                onComplete: () => {
                  intensity = 0;
                  apply();
                },
              }),
            );
          },
          setColor: (color: number) => {
            activeColor = color;
            apply();
          },
        };
      },
    };
    return effect;
  },
});
