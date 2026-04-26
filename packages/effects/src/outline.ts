import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { OutlineFilter } from "pixi-filters";
import type { OutlineHandle } from "./handles.js";

/** Options for the {@link outline} preset. */
export interface OutlineOptions {
  /** Outline thickness in pixels. Drives `getIntensity`. Default: 2. */
  thickness?: number;
  /** Outline color (0xRRGGBB). Default: 0x000000. */
  color?: number;
  /** Outline alpha 0..1. Default: 1. */
  alpha?: number;
  /** 0..1, higher = smoother but slower. Default: 0.1. */
  quality?: number;
  /** Render only outline (hide contents). Default: false. */
  knockout?: boolean;
}

/**
 * Hard-edge outline around opaque pixels. `setIntensity` scales the
 * configured thickness toward 0, which is also what `fadeIn`/`fadeOut`
 * tween. Saved across save/load.
 */
export const outline = defineEffect<OutlineHandle, OutlineOptions>({
  name: "yage:outline",
  factory: (options) => {
    let baseThickness = options.thickness ?? 2;
    const filter = new OutlineFilter({
      thickness: baseThickness,
      color: options.color ?? 0x000000,
      alpha: options.alpha ?? 1,
      quality: options.quality ?? 0.1,
      knockout: options.knockout ?? false,
    });
    const effect: Effect<OutlineHandle> = {
      filter,
      getIntensity: () => filter.thickness / Math.max(baseThickness, 1e-6),
      setIntensity: (v) => {
        filter.thickness = baseThickness * v;
      },
      buildExtras: () => ({
        setThickness: (value: number) => {
          baseThickness = value;
          filter.thickness = value;
        },
        setColor: (color: number) => {
          filter.color = color;
        },
      }),
    };
    return effect;
  },
});
