import { kawasePadding, localFilter } from "./localFilter.js";
import {
  validateFinite,
  validateInteger,
  validateMinimum,
} from "./validate.js";
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
  /** Blur strength in host-local pixels. Default: 8. */
  blur?: number;
  /** Blur quality. Default: 4. */
  quality?: number;
}

/**
 * Soft glow bloom from `pixi-filters`' AdvancedBloomFilter. The configured
 * `bloomScale` becomes the "full" value at `setIntensity(1)` — so
 * `fadeIn(seconds)` ramps from 0 to that value and `fadeOut(seconds)` back to 0.
 * `setBloomScale(...)` rebases the full value while preserving the current
 * intensity ratio so an in-flight fade or rhythmic pulse keeps animating
 * against the new ceiling instead of snapping back to 1.
 */
export const bloom = defineEffect<BloomHandle, BloomOptions>({
  name: "yage:bloom",
  factory: (options) => {
    let baseBloomScale = validateFinite(
      "bloom",
      "bloomScale",
      options.bloomScale ?? 1,
    );
    const blur = validateMinimum("bloom", "blur", options.blur ?? 8, 0);
    const quality = validateInteger(
      "bloom",
      "quality",
      options.quality ?? 4,
      1,
    );
    const filter = new AdvancedBloomFilter({
      threshold: options.threshold ?? 0.5,
      bloomScale: baseBloomScale,
      brightness: options.brightness ?? 1,
      blur,
      quality,
    });
    const local = localFilter(
      filter,
      ({ sizeScale }) => {
        filter.pixelSize = sizeScale;
      },
      ({ sizeScale }) => kawasePadding(blur, quality, sizeScale),
    );
    const effect: Effect<BloomHandle> = {
      filter,
      onAttach: local.onAttach,
      onDetach: local.onDetach,
      getIntensity: () => filter.bloomScale / Math.max(baseBloomScale, 1e-6),
      setIntensity: (v) => {
        filter.bloomScale =
          validateFinite("bloom", "intensity", v) * baseBloomScale;
      },
      buildExtras: () => ({
        setThreshold: (value: number) => {
          filter.threshold = validateFinite("bloom", "threshold", value);
        },
        setBloomScale: (value: number) => {
          validateFinite("bloom", "bloomScale", value);
          const ratio = filter.bloomScale / Math.max(baseBloomScale, 1e-6);
          baseBloomScale = value;
          filter.bloomScale = value * ratio;
        },
      }),
    };
    return effect;
  },
});
