import { Process, globalRandom } from "@yagejs/core";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { OldFilmFilter } from "pixi-filters";
import type { OldFilmHandle } from "./handles.js";

/** Options for the {@link oldFilm} preset. */
export interface OldFilmOptions {
  /** Sepia amount 0..1. Default: 0.3. */
  sepia?: number;
  /** Noise opacity 0..1. Default: 0.3. */
  noise?: number;
  /** Noise particle size. Default: 1. */
  noiseSize?: number;
  /** Scratch frequency 0..1. Default: 0.5. */
  scratch?: number;
  /** Scratch density 0..1. Default: 0.3. */
  scratchDensity?: number;
  /** Scratch width in pixels. Default: 1. */
  scratchWidth?: number;
  /** Vignette radius. Default: 0.3. */
  vignetting?: number;
  /** Vignette alpha. Default: 1. */
  vignettingAlpha?: number;
  /** Vignette blur. Default: 1. */
  vignettingBlur?: number;
}

/**
 * Vintage-film look: sepia tint, grain, scratches, vignette — all in one
 * pass via pixi-filters' OldFilmFilter. The grain/scratch seed self-advances
 * through the engine's process scheduler (mirrors `crt`), so the noise
 * shifts every frame, pauses with the owning scene, and time-scales with
 * it. No caller-side `step(dt)` wiring required.
 *
 * `setIntensity` routes through the inherited `filter.alpha` uniform — at
 * 0 the underlying pass still runs but contributes no visible pixels, so
 * `fadeIn`/`fadeOut` cross-fade the whole vintage look in lockstep instead
 * of touching only one knob.
 */
export const oldFilm = defineEffect<OldFilmHandle, OldFilmOptions>({
  name: "yage:oldFilm",
  factory: (options) => {
    const filter = new OldFilmFilter({
      sepia: options.sepia ?? 0.3,
      noise: options.noise ?? 0.3,
      noiseSize: options.noiseSize ?? 1,
      scratch: options.scratch ?? 0.5,
      scratchDensity: options.scratchDensity ?? 0.3,
      scratchWidth: options.scratchWidth ?? 1,
      vignetting: options.vignetting ?? 0.3,
      vignettingAlpha: options.vignettingAlpha ?? 1,
      vignettingBlur: options.vignettingBlur ?? 1,
    });
    // OldFilmFilter inherits Filter.alpha but its TS declaration omits it.
    const f = filter as unknown as { alpha: number };
    const effect: Effect<OldFilmHandle> = {
      filter,
      getIntensity: () => f.alpha,
      setIntensity: (v) => {
        f.alpha = Math.max(0, Math.min(1, v));
      },
      onActivate: (base) => {
        base.run(
          new Process({
            update: () => {
              filter.seed = globalRandom.float();
            },
          }),
        );
      },
    };
    return effect;
  },
});
