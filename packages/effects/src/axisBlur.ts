import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { BlurFilter } from "pixi.js";
import type { AxisBlurHandle } from "./handles.js";

export type BlurAxis = "horizontal" | "vertical";

/** Options for the {@link axisBlur} preset. */
export interface AxisBlurOptions {
  /** Main-axis blur strength in input-texture pixels. Default: 12. */
  strength?: number;
  /** Blur direction. Default: `"horizontal"`. */
  axis?: BlurAxis;
  /** Blur strength across the other axis. Default: 0. */
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
    let axis = options.axis ?? "horizontal";
    let strength = options.strength ?? 12;
    let perpendicular = options.perpendicularStrength ?? 0;
    const initial = strengths(axis, strength, perpendicular, intensity);
    const filter = new BlurFilter({
      strengthX: initial.x,
      strengthY: initial.y,
      quality: options.quality ?? 2,
      kernelSize: options.kernelSize ?? 5,
    });
    filter.repeatEdgePixels = options.repeatEdgePixels ?? false;

    const apply = (): void => {
      const value = strengths(axis, strength, perpendicular, intensity);
      filter.strengthX = value.x;
      filter.strengthY = value.y;
    };
    const effect: Effect<AxisBlurHandle> = {
      filter,
      getIntensity: () => intensity,
      setIntensity: (value) => {
        intensity = value;
        apply();
      },
      buildExtras: () => ({
        setStrength: (value: number) => {
          strength = value;
          apply();
        },
        setPerpendicularStrength: (value: number) => {
          perpendicular = value;
          apply();
        },
        setAxis: (value: BlurAxis) => {
          axis = value;
          apply();
        },
      }),
    };
    return effect;
  },
});
