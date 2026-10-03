import { localFilter, scaled } from "./localFilter.js";
import { validateFinite } from "./validate.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { RGBSplitFilter } from "pixi-filters";
import type { ChromaticAberrationHandle } from "./handles.js";

/** Options for the {@link chromaticAberration} preset. */
export interface ChromaticAberrationOptions {
  /**
   * Channel separation in host-local pixels. The red channel offsets `-separation` on
   * X, blue offsets `+separation` on X. Drives `getIntensity`. Default: 4.
   */
  separation?: number;
}

/**
 * RGB channel offset — the classic glitch / shockwave / hit-stop polish.
 * Wraps pixi-filters' RGBSplitFilter behind a single `separation` knob so
 * fades work cleanly. For asymmetric offsets, fall back to constructing
 * `RGBSplitFilter` directly via `rawFilter`.
 */
export const chromaticAberration = defineEffect<
  ChromaticAberrationHandle,
  ChromaticAberrationOptions
>({
  name: "yage:chromaticAberration",
  factory: (options) => {
    let separation = validateFinite(
      "chromaticAberration",
      "separation",
      options.separation ?? 4,
    );
    let intensity = 1;
    const filter = new RGBSplitFilter({
      red: { x: -separation, y: 0 },
      green: { x: 0, y: 0 },
      blue: { x: separation, y: 0 },
    });
    const local = localFilter(
      filter,
      ({ scaleX }) => {
        const value = scaled(separation * intensity, scaleX);
        filter.red = { x: -value, y: 0 };
        filter.blue = { x: value, y: 0 };
      },
      ({ scaleX }) => Math.abs(scaled(separation * intensity, scaleX)) + 1,
    );
    const effect: Effect<ChromaticAberrationHandle> = {
      filter,
      onAttach: local.onAttach,
      onDetach: local.onDetach,
      getIntensity: () => intensity,
      setIntensity: (value) => {
        intensity = validateFinite("chromaticAberration", "intensity", value);
        local.update();
      },
      buildExtras: () => ({
        setSeparation: (value: number) => {
          separation = validateFinite(
            "chromaticAberration",
            "separation",
            value,
          );
          local.update();
        },
      }),
    };
    return effect;
  },
});
