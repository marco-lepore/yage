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

// `time` value that's "obviously past the screen" — at the default speed of
// 500 px/s this is the radius reached after ~2 hours of simulation. Used as
// the parked state so toggling the effect on without a trigger yields no
// visible distortion.
const PARKED_TIME = 1e6;

/**
 * Concentric-ring ripple via pixi-filters' ShockwaveFilter — the impact
 * polish for explosions, slams, blast waves.
 *
 * Best applied at scene scope: the ring expands outward from `center` and
 * is naturally clipped at the host's bounds, so a component-scoped
 * shockwave on a small sprite reads as a tiny "bump" rather than a ring.
 *
 * Underlying `center` is a pixel coordinate in the host filter's input
 * frame — at scene scope that's the scene's render texture, so a
 * `trigger(heroX, heroY)` lines up with the entity's transform position.
 *
 * The filter starts in a "parked" state (time pushed past every visible
 * pixel) so toggling on is invisible until you `trigger()`. The trigger
 * ramp drives itself through the engine's process scheduler — pauses with
 * the owning scene, time-scales with it, auto-cancels on `remove()`.
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
      // Park the initial ring offscreen so toggling the effect on (without
      // a trigger) shows nothing. Without this, time=0 places the ring
      // exactly at `center`, producing a stationary "bump" pinned there.
      time: PARKED_TIME,
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
                  filter.time = PARKED_TIME;
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
