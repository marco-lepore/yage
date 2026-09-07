import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { BulgePinchFilter } from "pixi-filters";
import type { Container, FilterSystem, RenderSurface, Texture } from "pixi.js";
import { targetScale, toFilterRegion } from "./filterTarget.js";
import type { BulgePinchHandle } from "./handles.js";
import { validateFinite, validateMinimum, validatePoint } from "./validate.js";

/** Options for the {@link bulgePinch} preset. */
export interface BulgePinchOptions {
  /** Distortion strength: -1 strong pinch, 0 none, +1 strong bulge. Drives `getIntensity`. Default: 1. */
  strength?: number;
  /** Distortion radius in host-local pixels. Default: 100. */
  radius?: number;
  /** Center in the effect host's local coordinates. Omit for the host center. */
  center?: { x: number; y: number };
}

class YageBulgePinchFilter extends BulgePinchFilter {
  baseStrength: number;
  centerLocal: { x: number; y: number } | undefined;
  radiusLocal: number;
  /** Filter target captured by the host effect on attach. */
  yageTarget: Container | undefined;
  /**
   * Reused buffer for the per-frame `center` writeback. The upstream setter
   * stores the object it is handed, so writing into this one avoids
   * allocating an object every render frame.
   */
  private readonly centerOut = { x: 0, y: 0 };

  constructor(options: BulgePinchOptions) {
    const strength = validateFinite(
      "bulgePinch",
      "strength",
      options.strength ?? 1,
    );
    const radius = validateMinimum(
      "bulgePinch",
      "radius",
      options.radius ?? 100,
      0,
    );
    // The super values only cover the frame before `onAttach` supplies a
    // target; `apply()` rewrites both every frame after that.
    super({ strength, radius, center: { x: 0.5, y: 0.5 } });
    this.baseStrength = strength;
    this.radiusLocal = radius;
    this.centerLocal = options.center
      ? { ...validatePoint("bulgePinch", "center", options.center) }
      : undefined;
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const target = this.yageTarget;
    const center = this.centerLocal;
    if (target && center) {
      toFilterRegion(target, filterManager, center.x, center.y, this.centerOut);
      // The shader multiplies `uCenter` back by the region's frame size, so
      // dividing by it here yields the region-relative pixel offset above.
      this.centerOut.x /= input.frame.width;
      this.centerOut.y /= input.frame.height;
    } else {
      this.centerOut.x = 0.5;
      this.centerOut.y = 0.5;
    }
    this.center = this.centerOut;
    this.radius = this.radiusLocal * targetScale(target).sizeScale;
    super.apply(filterManager, input, output, clearMode);
  }
}

/**
 * Lens-distortion bulge or pinch via pixi-filters' BulgePinchFilter. Useful
 * for fish-eye flourishes, telescope reveals, or stomach-punch hits.
 *
 * `center` and `radius` are in the host's local coordinates and are converted
 * to the rasterized filter region every frame, so the lens stays on the point
 * the game names at any window size, fit ratio or pixel density.
 *
 * `setIntensity` scales the configured `strength` from 0 (no distortion) to
 * its full magnitude — preserving the sign, so a pinch-configured filter
 * fades from flat → pinch (not flat → bulge → pinch).
 *
 * `setStrength` rebases the full value while preserving the current
 * intensity ratio so a fade in flight keeps animating against the new
 * ceiling instead of snapping back to 1.
 */
export const bulgePinch = defineEffect<BulgePinchHandle, BulgePinchOptions>({
  name: "yage:bulgePinch",
  factory: (options) => {
    const filter = new YageBulgePinchFilter(options);
    const effect: Effect<BulgePinchHandle> = {
      filter,
      // Magnitude-based ratio: pinch (negative strength) and bulge (positive)
      // both report intensity in [0, 1] without sign flips.
      getIntensity: () =>
        Math.abs(filter.strength) /
        Math.max(Math.abs(filter.baseStrength), 1e-6),
      setIntensity: (v) => {
        filter.strength =
          filter.baseStrength * validateFinite("bulgePinch", "intensity", v);
      },
      onAttach: ({ displayObject }) => {
        filter.yageTarget = displayObject;
      },
      onDetach: () => {
        filter.yageTarget = undefined;
      },
      buildExtras: () => ({
        setStrength: (value: number) => {
          // Preserve magnitude ratio; rebase keeps current intensity AND
          // adopts the new sign (so toggling pinch ↔ bulge actually flips
          // direction instead of stalling at the previous polarity).
          const ratio =
            Math.abs(filter.strength) /
            Math.max(Math.abs(filter.baseStrength), 1e-6);
          filter.baseStrength = validateFinite("bulgePinch", "strength", value);
          filter.strength = filter.baseStrength * ratio;
        },
        setCenter: (x: number, y: number) => {
          filter.centerLocal = validatePoint("bulgePinch", "center", { x, y });
        },
        useHostCenter: () => {
          filter.centerLocal = undefined;
        },
        setRadius: (value: number) => {
          filter.radiusLocal = validateMinimum(
            "bulgePinch",
            "radius",
            value,
            0,
          );
        },
      }),
    };
    return effect;
  },
});
