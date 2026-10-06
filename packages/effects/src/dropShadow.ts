import { kawasePadding, localFilter, scaled } from "./localFilter.js";
import {
  validateFinite,
  validateInteger,
  validateMinimum,
  validatePoint,
} from "./validate.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { DropShadowFilter } from "pixi-filters";
import type { DropShadowHandle } from "./handles.js";

/** Options for the {@link dropShadow} preset. */
export interface DropShadowOptions {
  /** Shadow offset in host-local pixels. Default: { x: 4, y: 4 }. */
  offset?: { x: number; y: number };
  /** Shadow color (0xRRGGBB). Default: 0x000000. */
  color?: number;
  /** Shadow alpha 0..1. Drives `getIntensity`. Default: 0.5. */
  alpha?: number;
  /** Shadow blur strength in host-local pixels. Default: 4. */
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
    let baseAlpha = validateFinite("dropShadow", "alpha", options.alpha ?? 0.5);
    let offset = {
      ...validatePoint(
        "dropShadow",
        "offset",
        options.offset ?? { x: 4, y: 4 },
      ),
    };
    const blur = validateMinimum("dropShadow", "blur", options.blur ?? 4, 0);
    const quality = validateInteger(
      "dropShadow",
      "quality",
      options.quality ?? 3,
      1,
    );
    const filter = new DropShadowFilter({
      offset: { ...offset },
      color: options.color ?? 0x000000,
      alpha: baseAlpha,
      blur,
      quality,
      shadowOnly: options.shadowOnly ?? false,
    });
    const local = localFilter(
      filter,
      ({ scaleX, scaleY, sizeScale }) => {
        const x = scaled(offset.x, scaleX);
        const y = scaled(offset.y, scaleY);
        filter.offset = { x, y };
        filter.pixelSize = sizeScale;
      },
      ({ scaleX, scaleY, sizeScale }) =>
        Math.max(
          Math.abs(scaled(offset.x, scaleX)),
          Math.abs(scaled(offset.y, scaleY)),
        ) + kawasePadding(blur, quality, sizeScale),
    );
    const effect: Effect<DropShadowHandle> = {
      filter,
      onAttach: local.onAttach,
      onDetach: local.onDetach,
      getIntensity: () => filter.alpha / Math.max(baseAlpha, 1e-6),
      setIntensity: (v) => {
        filter.alpha = validateFinite("dropShadow", "intensity", v) * baseAlpha;
      },
      buildExtras: () => ({
        setOffset: (x: number, y: number) => {
          offset = validatePoint("dropShadow", "offset", { x, y });
          local.update();
        },
        setColor: (color: number) => {
          filter.color = color;
        },
        setAlpha: (value: number) => {
          validateFinite("dropShadow", "alpha", value);
          const ratio = filter.alpha / Math.max(baseAlpha, 1e-6);
          baseAlpha = value;
          filter.alpha = value * ratio;
        },
      }),
    };
    return effect;
  },
});
