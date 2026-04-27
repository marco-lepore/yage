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
 * `setBloomScale(...)` rebases the full value while preserving the current
 * intensity ratio so an in-flight fade or rhythmic pulse keeps animating
 * against the new ceiling instead of snapping back to 1.
 */
export const bloom = defineEffect<BloomHandle, BloomOptions>({
  name: "yage:bloom",
  factory: (options) => {
    let baseBloomScale = options.bloomScale ?? 1;
    const baseBlur = options.blur ?? 8;
    const filter = new AdvancedBloomFilter({
      threshold: options.threshold ?? 0.5,
      bloomScale: baseBloomScale,
      brightness: options.brightness ?? 1,
      blur: baseBlur,
      quality: options.quality ?? 4,
    });
    // Bloom blur extends past the source bounds — pad so the halo isn't
    // clipped at the display object's bounding box.
    filter.padding = baseBlur * 2 + 8;
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
          const ratio = filter.bloomScale / Math.max(baseBloomScale, 1e-6);
          baseBloomScale = value;
          filter.bloomScale = value * ratio;
        },
      }),
    };
    return effect;
  },
});
