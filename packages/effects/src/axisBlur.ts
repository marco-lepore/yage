import { gaussianPadding, localFilter, scaled } from "./localFilter.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { BlurFilter } from "pixi.js";
import type { AxisBlurHandle } from "./handles.js";
import { validateFinite, validateInteger, validateOneOf } from "./validate.js";

export type BlurAxis = "horizontal" | "vertical";

/** Options for the {@link axisBlur} preset. */
export interface AxisBlurOptions {
  /** Main-axis blur strength in host-local pixels. Default: 12. */
  strength?: number;
  /** Blur direction. Default: `"horizontal"`. */
  axis?: BlurAxis;
  /** Blur strength across the other axis, in host-local pixels. Default: 0. */
  perpendicularStrength?: number;
  /** Number of blur passes. Default: 2. */
  quality?: number;
  /** Blur kernel size: 5, 7, 9, 11, 13, or 15. Default: 5. */
  kernelSize?: 5 | 7 | 9 | 11 | 13 | 15;
  /** Repeat edge pixels instead of sampling transparent space. Default: false. */
  repeatEdgePixels?: boolean;
}

function strengths(
  axis: BlurAxis,
  strength: number,
  perpendicular: number,
  intensity: number,
): { x: number; y: number } {
  return axis === "horizontal"
    ? { x: strength * intensity, y: perpendicular * intensity }
    : { x: perpendicular * intensity, y: strength * intensity };
}

/** Symmetric Gaussian blur constrained to one axis. */
export const axisBlur = defineEffect<AxisBlurHandle, AxisBlurOptions>({
  name: "yage:axisBlur",
  factory: (options) => {
    let intensity = 1;
    let axis = validateOneOf("axisBlur", "axis", options.axis ?? "horizontal", [
      "horizontal",
      "vertical",
    ]);
    let strength = validateFinite(
      "axisBlur",
      "strength",
      options.strength ?? 12,
    );
    let perpendicular = validateFinite(
      "axisBlur",
      "perpendicularStrength",
      options.perpendicularStrength ?? 0,
    );
    const quality = validateInteger(
      "axisBlur",
      "quality",
      options.quality ?? 2,
      1,
    );
    const kernelSize = options.kernelSize ?? 5;
    if (![5, 7, 9, 11, 13, 15].includes(kernelSize))
      throw new Error(`axisBlur: invalid kernelSize, got ${kernelSize}.`);
    const initial = strengths(axis, strength, perpendicular, intensity);
    const filter = new BlurFilter({
      strengthX: initial.x,
      strengthY: initial.y,
      quality,
      kernelSize,
    });
    filter.repeatEdgePixels = options.repeatEdgePixels ?? false;

    const local = localFilter(
      filter,
      ({ scaleX, scaleY }) => {
        const value = strengths(axis, strength, perpendicular, intensity);
        const x = scaled(value.x, scaleX);
        const y = scaled(value.y, scaleY);
        filter.strengthX = x;
        filter.strengthY = y;
      },
      ({ scaleX, scaleY }) => {
        if (filter.repeatEdgePixels) return 0;
        const value = strengths(axis, strength, perpendicular, intensity);
        return gaussianPadding(
          Math.max(
            Math.abs(scaled(value.x, scaleX)),
            Math.abs(scaled(value.y, scaleY)),
          ),
          quality,
          kernelSize,
        );
      },
    );
    const apply = local.update;
    const effect: Effect<AxisBlurHandle> = {
      filter,
      onAttach: local.onAttach,
      onDetach: local.onDetach,
      getIntensity: () => intensity,
      setIntensity: (value) => {
        intensity = validateFinite("axisBlur", "intensity", value);
        apply();
      },
      buildExtras: () => ({
        setStrength: (value: number) => {
          strength = validateFinite("axisBlur", "strength", value);
          apply();
        },
        setPerpendicularStrength: (value: number) => {
          perpendicular = validateFinite(
            "axisBlur",
            "perpendicularStrength",
            value,
          );
          apply();
        },
        setAxis: (value: BlurAxis) => {
          axis = validateOneOf("axisBlur", "axis", value, [
            "horizontal",
            "vertical",
          ]);
          apply();
        },
      }),
    };
    return effect;
  },
});
