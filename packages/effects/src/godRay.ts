import { Process } from "@yagejs/core";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { GodrayFilter } from "pixi-filters";
import type { GodRayHandle } from "./handles.js";

/** Options for the {@link godRay} preset. */
export interface GodRayOptions {
  /** Ray angle in degrees (0 = vertical, ±90 = horizontal). Default: 30. */
  angle?: number;
  /** Ray strength 0..1. Drives `getIntensity`. Default: 0.5. */
  gain?: number;
  /** Fractal-noise density — higher = more, finer rays. Default: 2.5. */
  lacunarity?: number;
  /** Ray opacity 0..1. Default: 1. */
  alpha?: number;
}

/**
 * Animated god-rays / volumetric light shafts via pixi-filters' GodrayFilter.
 * The `time` uniform self-advances through the engine's process scheduler on
 * attach — pauses with the owning scene, time-scales with it. No caller-side
 * `step(dt)` wiring required.
 *
 * `setIntensity` scales the configured `gain` from 0 to its full value, so
 * `fadeIn` ramps the rays in cleanly. `setGain` rebases the full value while
 * preserving the current intensity ratio (mirrors bloom/outline/glow).
 */
export const godRay = defineEffect<GodRayHandle, GodRayOptions>({
  name: "yage:godRay",
  factory: (options) => {
    let baseGain = options.gain ?? 0.5;
    const filter = new GodrayFilter({
      angle: options.angle ?? 30,
      gain: baseGain,
      lacunarity: options.lacunarity ?? 2.5,
      alpha: options.alpha ?? 1,
      parallel: true,
    });
    const effect: Effect<GodRayHandle> = {
      filter,
      getIntensity: () => filter.gain / Math.max(baseGain, 1e-6),
      setIntensity: (v) => {
        filter.gain = baseGain * v;
      },
      buildExtras: () => ({
        setAngle: (value: number) => {
          filter.angle = value;
        },
        setGain: (value: number) => {
          const ratio = filter.gain / Math.max(baseGain, 1e-6);
          baseGain = value;
          filter.gain = value * ratio;
        },
      }),
      onActivate: (base) => {
        // Self-schedule the time animator (mirrors crt). `dt` is in seconds,
        // the unit GodrayFilter.time advances in.
        base.run(
          new Process({
            update: (dt) => {
              filter.time += dt;
            },
          }),
        );
      },
    };
    return effect;
  },
});
