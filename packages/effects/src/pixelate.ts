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
 * Pixelation. `setIntensity` linearly scales the configured `size` from 1
 * (effectively smooth) to the original value. The live `size` is clamped to
 * a minimum of 1 — `size: 0` would divide-by-zero in the shader — so a
 * fade-out doesn't quite reach a visually unfiltered state; remove the
 * effect rather than fading to 0 if you want the filter cost gone.
 */
export const pixelate = defineEffect<PixelateHandle, PixelateOptions>({
  name: "yage:pixelate",
  factory: (options) => {
    let baseSize = options.size ?? 8;
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
          // Preserve the current intensity ratio so a fade or pulse keeps
          // animating against the new ceiling. PixelateFilter.size still
          // clamps to ≥ 1 (a value of 0 would divide-by-zero in the shader).
          const ratio = filter.sizeX / Math.max(baseSize, 1);
          baseSize = value;
          filter.size = Math.max(1, Math.round(value * ratio));
        },
      }),
    };
    return effect;
  },
});
