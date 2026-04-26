import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { AdvancedBloomFilter } from "pixi-filters";
import type { BloomHandle } from "./handles.js";

/** Options for the {@link bloom} preset. */
export interface BloomOptions {
  /** Brightness threshold above which pixels bloom. Default: 0.5. */
  threshold?: number;
  /** Bloom strength multiplier. The "full" value `setIntensity(1)` produces. Default: 1. */
  bloomScale?: number;
  /** Overall brightness boost. Default: 1. */
  brightness?: number;
  /** Blur strength. Default: 8. */
  blur?: number;
  /** Blur quality. Default: 4. */
  quality?: number;
}

/**
 * Soft glow bloom from `pixi-filters`' AdvancedBloomFilter. The configured
 * `bloomScale` becomes the "full" value at `setIntensity(1)` — so
 * `fadeIn(ms)` ramps from 0 to that value and `fadeOut(ms)` back to 0.
 * `setBloomScale(...)` updates the full value (and re-applies it).
 */
export const bloom = defineEffect<BloomHandle, BloomOptions>({
  name: "yage:bloom",
  factory: (options) => {
    let baseBloomScale = options.bloomScale ?? 1;
    const filter = new AdvancedBloomFilter({
      threshold: options.threshold ?? 0.5,
      bloomScale: baseBloomScale,
      brightness: options.brightness ?? 1,
      blur: options.blur ?? 8,
      quality: options.quality ?? 4,
    });
    const effect: Effect<BloomHandle> = {
      filter,
      getIntensity: () => filter.bloomScale / Math.max(baseBloomScale, 1e-6),
      setIntensity: (v) => {
        filter.bloomScale = baseBloomScale * v;
      },
      buildExtras: () => ({
        setThreshold: (value: number) => {
          filter.threshold = value;
        },
        setBloomScale: (value: number) => {
          baseBloomScale = value;
          filter.bloomScale = value;
        },
      }),
    };
    return effect;
  },
});
