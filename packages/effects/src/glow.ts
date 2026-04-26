import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { GlowFilter } from "pixi-filters";
import type { GlowHandle } from "./handles.js";

/** Options for the {@link glow} preset. */
export interface GlowOptions {
  /** Glow color (0xRRGGBB). Default: 0xffffff. */
  color?: number;
  /** Glow distance in pixels. Default: 10. */
  distance?: number;
  /** Outer-edge glow strength. Drives `getIntensity`. Default: 4. */
  outerStrength?: number;
  /** Inner-edge glow strength. Default: 0. */
  innerStrength?: number;
  /** Glow alpha. Default: 1. */
  alpha?: number;
  /** Quality 0..1, higher = slower. Default: 0.1. */
  quality?: number;
  /** Render only glow, not the contents. Default: false. */
  knockout?: boolean;
}

/**
 * Outer/inner glow halo via pixi-filters' GlowFilter. `setIntensity` scales
 * `outerStrength` from 0 to its configured value.
 */
export const glow = defineEffect<GlowHandle, GlowOptions>({
  name: "yage:glow",
  factory: (options) => {
    let baseOuter = options.outerStrength ?? 4;
    const filter = new GlowFilter({
      color: options.color ?? 0xffffff,
      distance: options.distance ?? 10,
      outerStrength: baseOuter,
      innerStrength: options.innerStrength ?? 0,
      alpha: options.alpha ?? 1,
      quality: options.quality ?? 0.1,
      knockout: options.knockout ?? false,
    });
    const effect: Effect<GlowHandle> = {
      filter,
      getIntensity: () => filter.outerStrength / Math.max(baseOuter, 1e-6),
      setIntensity: (v) => {
        filter.outerStrength = baseOuter * v;
      },
      buildExtras: () => ({
        setOuterStrength: (value: number) => {
          baseOuter = value;
          filter.outerStrength = value;
        },
        setInnerStrength: (value: number) => {
          filter.innerStrength = value;
        },
        setColor: (color: number) => {
          filter.color = color;
        },
      }),
    };
    return effect;
  },
});
