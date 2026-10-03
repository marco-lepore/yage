import { localFilter, scaled } from "./localFilter.js";
import { validateFinite, validateMinimum } from "./validate.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { OutlineFilter } from "pixi-filters";
import type { OutlineHandle } from "./handles.js";

/** Options for the {@link outline} preset. */
export interface OutlineOptions {
  /** Outline thickness in host-local pixels. Drives `getIntensity`. Default: 2. */
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
 * tween.
 */
export const outline = defineEffect<OutlineHandle, OutlineOptions>({
  name: "yage:outline",
  factory: (options) => {
    let thickness = validateMinimum(
      "outline",
      "thickness",
      options.thickness ?? 2,
      0,
    );
    let intensity = 1;
    const filter = new OutlineFilter({
      thickness,
      color: options.color ?? 0x000000,
      alpha: options.alpha ?? 1,
      quality: options.quality ?? 0.1,
      knockout: options.knockout ?? false,
    });
    const local = localFilter(
      filter,
      ({ sizeScale }) => {
        filter.thickness = scaled(thickness * intensity, sizeScale);
      },
      ({ sizeScale }) => Math.abs(scaled(thickness * intensity, sizeScale)) + 1,
    );
    const effect: Effect<OutlineHandle> = {
      filter,
      onAttach: local.onAttach,
      onDetach: local.onDetach,
      getIntensity: () => intensity,
      setIntensity: (value) => {
        intensity = validateFinite("outline", "intensity", value);
        local.update();
      },
      buildExtras: () => ({
        setThickness: (value: number) => {
          thickness = validateMinimum("outline", "thickness", value, 0);
          local.update();
        },
        setColor: (color: number) => {
          filter.color = color;
        },
      }),
    };
    return effect;
  },
});
