import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { ColorMatrixFilter } from "pixi.js";
import type { ColorGradeHandle, ColorGradePreset } from "./handles.js";

/** Options for the {@link colorGrade} preset. */
export interface ColorGradeOptions {
  /** Built-in grade preset. Default: "neutral". */
  preset?: ColorGradePreset;
  /** Initial blend amount 0..1. Default: 1. */
  amount?: number;
}

const applyPreset = (
  filter: ColorMatrixFilter,
  preset: ColorGradePreset,
): void => {
  switch (preset) {
    case "neutral":
      filter.reset();
      break;
    case "sepia":
      filter.reset();
      filter.sepia(true);
      break;
    case "grayscale":
      filter.reset();
      filter.grayscale(1, true);
      break;
    case "negative":
      filter.reset();
      filter.negative(true);
      break;
    case "night":
      filter.reset();
      filter.night(0.5, true);
      break;
    case "warm":
      filter.reset();
      filter.brightness(1.05, true);
      filter.tint(0xffd2a8, true);
      break;
    case "cool":
      filter.reset();
      filter.tint(0xb0d8ff, true);
      break;
  }
};

/**
 * Color grading via the built-in `ColorMatrixFilter` with a few named
 * presets (sepia, grayscale, negative, night, warm, cool, neutral).
 *
 * `setIntensity` cross-fades the matrix toward identity by lerping the
 * filter's `alpha` uniform — at 0 the filter passes the original through,
 * at 1 the preset is fully applied.
 */
export const colorGrade = defineEffect<ColorGradeHandle, ColorGradeOptions>({
  name: "yage:colorGrade",
  factory: (options) => {
    const filter = new ColorMatrixFilter();
    let preset: ColorGradePreset = options.preset ?? "neutral";
    applyPreset(filter, preset);
    filter.alpha = options.amount ?? 1;
    const effect: Effect<ColorGradeHandle> = {
      filter,
      getIntensity: () => filter.alpha,
      setIntensity: (v) => {
        filter.alpha = v;
      },
      buildExtras: () => ({
        setPreset: (p: ColorGradePreset) => {
          preset = p;
          applyPreset(filter, preset);
        },
      }),
    };
    return effect;
  },
});
