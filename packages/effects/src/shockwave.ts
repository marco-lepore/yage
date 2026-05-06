import { Process } from "@yagejs/core";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { ShockwaveFilter } from "pixi-filters";
import type { ShockwaveHandle } from "./handles.js";

/** Options for the {@link shockwave} preset. */
export interface ShockwaveOptions {
  /** Ripple speed in pixels/second. Default: 500. */
  speed?: number;
  /** Ripple amplitude in pixels. Default: 30. */
  amplitude?: number;
  /** Ripple wavelength in pixels. Default: 160. */
  wavelength?: number;
  /** Ripple brightness multiplier. Default: 1. */
  brightness?: number;
  /** Maximum radius in pixels (-1 for infinite). Default: -1. */
  radius?: number;
  /** Auto-trigger duration in ms — ramp `time` from 0 then idle. Default: 1000. */
  duration?: number;
}

/**
 * Concentric-ring ripple via pixi-filters' ShockwaveFilter — the impact
 * polish for explosions, slams, blast waves. The filter's `time` uniform is
 * what drives the ring outward; this preset wraps it behind a `trigger(x, y)`
 * convenience that:
 *
 *  1. Sets `center` to the strike point (in the host's local pixel space),
 *  2. Resets `time` to 0,
 *  3. Schedules a self-running ramp through the engine's process scheduler
 *     that advances `time` in seconds for `duration` ms before parking the
 *     ripple offscreen (effectively idle until the next trigger).
 *
 * The internal Process pauses with the owning scene, time-scales with it,
 * and is auto-cancelled on `remove()` — no caller-side `step(dt)` wiring.
 *
 * `setIntensity` cross-fades amplitude × brightness from 0 to the configured
 * values so `fadeIn`/`fadeOut` work the same as on every other preset.
 */
export const shockwave = defineEffect<ShockwaveHandle, ShockwaveOptions>({
  name: "yage:shockwave",
  factory: (options) => {
    const baseAmplitude = options.amplitude ?? 30;
    const baseBrightness = options.brightness ?? 1;
    const duration = options.duration ?? 1000;
    const filter = new ShockwaveFilter({
      speed: options.speed ?? 500,
      amplitude: baseAmplitude,
      wavelength: options.wavelength ?? 160,
      brightness: baseBrightness,
      radius: options.radius ?? -1,
      time: 0,
    });
    let intensity = 1;
    const apply = (): void => {
      filter.amplitude = baseAmplitude * intensity;
      filter.brightness = baseBrightness * intensity;
    };
    apply();
    const effect: Effect<ShockwaveHandle> = {
      filter,
      getIntensity: () => intensity,
      setIntensity: (v) => {
        intensity = v;
        apply();
      },
      buildExtras: (base) => {
        let inFlight: Process | undefined;
        return {
          trigger: (x = 0, y = 0) => {
            // Cancel any in-flight ramp before starting a new one — overlapping
            // shockwaves on the same filter would otherwise stomp `time`
            // mid-frame and produce a visible glitch.
            inFlight?.cancel();
            filter.center = { x, y };
            filter.time = 0;
            inFlight = base.run(
              new Process({
                duration,
                update: (dt) => {
                  filter.time += dt / 1000;
                },
                onComplete: () => {
                  // Park the ring far outside any reasonable viewport so it
                  // stops contributing visible pixels until the next trigger.
                  filter.time = 1e6;
                },
              }),
            );
          },
        };
      },
    };
    return effect;
  },
});
