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
  /** Outer-edge glow strength. Default: 4. */
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
 * BOTH `outerStrength` and `innerStrength` proportionally to the configured
 * full values, so a halo that uses both reads as breathing in lockstep
 * rather than only the outer edge fading.
 *
 * `setOuterStrength` / `setInnerStrength` rebase the configured "full"
 * value while preserving the current intensity ratio — so changing a
 * strength mid-fade or mid-pulse raises the ceiling without snapping the
 * visible halo back to 1.
 */
export const glow = defineEffect<GlowHandle, GlowOptions>({
  name: "yage:glow",
  factory: (options) => {
    let baseOuter = options.outerStrength ?? 4;
    let baseInner = options.innerStrength ?? 0;
    const distance = options.distance ?? 10;
    const filter = new GlowFilter({
      color: options.color ?? 0xffffff,
      distance,
      outerStrength: baseOuter,
      innerStrength: baseInner,
      alpha: options.alpha ?? 1,
      quality: options.quality ?? 0.1,
      knockout: options.knockout ?? false,
    });
    // GlowFilter's outer halo extends `distance` pixels past the source.
    filter.padding = distance + 4;
    // Read intensity off whichever knob is configured non-zero. We keep the
    // two scales in lockstep through setIntensity, so any non-zero base is a
    // valid normalizer; preferring outer is just convention (the more common
    // default).
    const readIntensity = (): number => {
      if (baseOuter > 0) return filter.outerStrength / baseOuter;
      if (baseInner > 0) return filter.innerStrength / baseInner;
      return 1;
    };
    const effect: Effect<GlowHandle> = {
      filter,
      getIntensity: readIntensity,
      setIntensity: (v) => {
        filter.outerStrength = baseOuter * v;
        filter.innerStrength = baseInner * v;
      },
      buildExtras: () => ({
        setOuterStrength: (value: number) => {
          const ratio = baseOuter > 0 ? filter.outerStrength / baseOuter : 1;
          baseOuter = value;
          filter.outerStrength = value * ratio;
        },
        setInnerStrength: (value: number) => {
          const ratio = baseInner > 0 ? filter.innerStrength / baseInner : 1;
          baseInner = value;
          filter.innerStrength = value * ratio;
        },
        setColor: (color: number) => {
          filter.color = color;
        },
      }),
    };
    return effect;
  },
});
