import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { DropShadowFilter } from "pixi-filters";
import type { DropShadowHandle } from "./handles.js";

/** Options for the {@link dropShadow} preset. */
export interface DropShadowOptions {
  /** Shadow offset relative to the original. Default: { x: 4, y: 4 }. */
  offset?: { x: number; y: number };
  /** Shadow color (0xRRGGBB). Default: 0x000000. */
  color?: number;
  /** Shadow alpha 0..1. Drives `getIntensity`. Default: 0.5. */
  alpha?: number;
  /** Shadow blur strength. Default: 4. */
  blur?: number;
  /** Blur quality. Default: 3. */
  quality?: number;
  /** Hide the original, show only the shadow. Default: false. */
  shadowOnly?: boolean;
}

/**
 * Drop shadow via pixi-filters. `setIntensity` tracks alpha so fades work
 * naturally — at intensity 0 the shadow is invisible.
 */
export const dropShadow = defineEffect<DropShadowHandle, DropShadowOptions>({
  name: "yage:dropShadow",
  factory: (options) => {
    let baseAlpha = options.alpha ?? 0.5;
    const baseOffset = options.offset ?? { x: 4, y: 4 };
    const baseBlur = options.blur ?? 4;
    const filter = new DropShadowFilter({
      offset: baseOffset,
      color: options.color ?? 0x000000,
      alpha: baseAlpha,
      blur: baseBlur,
      quality: options.quality ?? 3,
      shadowOnly: options.shadowOnly ?? false,
    });
    // The shadow extends beyond the source's bounds by offset + blur radius;
    // pad accordingly so the trailing edge isn't clipped.
    const padFor = (offX: number, offY: number, blur: number): number =>
      Math.max(Math.abs(offX), Math.abs(offY)) + blur * 2 + 4;
    filter.padding = padFor(baseOffset.x, baseOffset.y, baseBlur);
    const effect: Effect<DropShadowHandle> = {
      filter,
      getIntensity: () => filter.alpha / Math.max(baseAlpha, 1e-6),
      setIntensity: (v) => {
        filter.alpha = baseAlpha * v;
      },
      buildExtras: () => ({
        setOffset: (x: number, y: number) => {
          filter.offset = { x, y };
          filter.padding = padFor(x, y, baseBlur);
        },
        setColor: (color: number) => {
          filter.color = color;
        },
        setAlpha: (value: number) => {
          baseAlpha = value;
          filter.alpha = value;
        },
      }),
    };
    return effect;
  },
});
