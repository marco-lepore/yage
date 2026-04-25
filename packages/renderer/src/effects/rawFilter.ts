import type { Filter } from "pixi.js";
import type { Effect, EffectFactory } from "./Effect.js";

/** Options for {@link rawFilter}. */
export interface RawFilterOptions {
  /**
   * Optional accessor for the filter's primary intensity uniform. If
   * provided, `fadeIn` / `fadeOut` on the resulting handle will tween it.
   * If omitted, fades become no-ops and a one-shot dev warning fires.
   */
  intensity?: { get: () => number; set: (value: number) => void };
}

let warned = false;

/**
 * Wrap a user-supplied pixi `Filter` so it can be attached through the
 * `addEffect` API and managed by the same handle interface as built-in
 * effect presets. The escape hatch for custom shaders or any pixi-filters
 * import the engine doesn't expose a typed wrapper for.
 *
 * ```ts
 * import { BlurFilter } from "pixi.js";
 * sprite.addEffect(rawFilter(new BlurFilter({ strength: 8 }), {
 *   intensity: {
 *     get: () => filter.strength,
 *     set: (v) => { filter.strength = v * 8; },
 *   },
 * }));
 * ```
 *
 * Without the `intensity` option, `fadeIn` / `fadeOut` will return an
 * already-completed Process and warn once per session — the system can't
 * guess which uniform represents the effect's "strength."
 */
export function rawFilter(
  filter: Filter,
  options?: RawFilterOptions,
): EffectFactory {
  return () => {
    const intensity = options?.intensity;
    const effect: Effect = {
      filter,
      getIntensity: () => intensity?.get() ?? 1,
      setIntensity: (value) => {
        if (intensity) {
          intensity.set(value);
          return;
        }
        if (!warned) {
          warned = true;
          console.warn(
            "rawFilter: fadeIn/fadeOut called on a filter without an `intensity` option — fades will no-op. " +
              "Pass { intensity: { get, set } } to enable fading.",
          );
        }
      },
    };
    return effect;
  };
}

/** @internal — reset the one-shot warning flag for tests. */
export function _resetRawFilterWarning(): void {
  warned = false;
}
