import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { RGBSplitFilter } from "pixi-filters";
import type { ChromaticAberrationHandle } from "./handles.js";

/** Options for the {@link chromaticAberration} preset. */
export interface ChromaticAberrationOptions {
  /**
   * Channel separation in pixels. The red channel offsets `-separation` on
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
    const baseSeparation = options.separation ?? 4;
    const filter = new RGBSplitFilter({
      red: { x: -baseSeparation, y: 0 },
      green: { x: 0, y: 0 },
      blue: { x: baseSeparation, y: 0 },
    });
    const apply = (sep: number): void => {
      filter.red = { x: -sep, y: 0 };
      filter.blue = { x: sep, y: 0 };
    };
    const effect: Effect<ChromaticAberrationHandle> = {
      filter,
      getIntensity: () => {
        const r = filter.red as { x: number };
        return -r.x / Math.max(baseSeparation, 1e-6);
      },
      setIntensity: (v) => apply(baseSeparation * v),
      buildExtras: () => ({
        setSeparation: (value: number) => apply(value),
      }),
    };
    return effect;
  },
});
