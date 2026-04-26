import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { PixelateFilter } from "pixi-filters";
import type { PixelateHandle } from "./handles.js";

/** Options for the {@link pixelate} preset. */
export interface PixelateOptions {
  /** Pixel block size. Drives `getIntensity`. Default: 8. */
  size?: number;
}

/**
 * Pixelation. `setIntensity` linearly scales the configured `size` from 0
 * (smooth) to the original value, so `fadeIn`/`fadeOut` work without
 * `withFade` — though the visual at intensity 0 is the same as removing the
 * filter, since `size: 0` would be a divide-by-zero. We clamp to 1 minimum.
 */
export const pixelate = defineEffect<PixelateHandle, PixelateOptions>({
  name: "yage:pixelate",
  factory: (options) => {
    const baseSize = options.size ?? 8;
    const filter = new PixelateFilter(baseSize);
    const effect: Effect<PixelateHandle> = {
      filter,
      // PixelateFilter.size returns a `Float32Array(2)` — `Array.isArray`
      // is false on typed arrays, so a generic union-narrowing read here
      // would fall through to `s.x` and yield `undefined → NaN`. NaN
      // round-trips through `JSON.stringify` as `null`, so saving silently
      // loses the intensity and restoring with `setIntensity(null)` ends
      // up at `size = 1` (effectively no pixelation). Read `sizeX`
      // directly — it's a number-typed getter on the filter.
      getIntensity: () => filter.sizeX / Math.max(baseSize, 1),
      setIntensity: (v) => {
        filter.size = Math.max(1, Math.round(baseSize * v));
      },
      buildExtras: () => ({
        setSize: (value: number) => {
          filter.size = Math.max(1, Math.round(value));
        },
      }),
    };
    return effect;
  },
});
