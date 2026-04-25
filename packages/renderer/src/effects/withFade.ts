import { AlphaFilter } from "pixi.js";
import type { Filter } from "pixi.js";
import type { Effect, EffectFactory } from "./Effect.js";
import type { EffectHandle } from "./EffectHandle.js";

/**
 * Wrap an effect so its handle's `fadeIn` / `fadeOut` tween an `AlphaFilter`
 * appended after the inner filter chain, instead of the inner effect's
 * native intensity.
 *
 * Useful for shader-style effects where there's no clean scalar uniform to
 * tween (CRT, vignette, custom color grades). Costs one extra render pass.
 * Ship raw by default; opt into `withFade` only when fades are required.
 *
 * ```ts
 * sprite.addEffect(withFade(crt({ scanlines: true }))).fadeIn(500);
 * ```
 */
export function withFade<H extends EffectHandle>(
  inner: EffectFactory<H>,
): EffectFactory<H> {
  return () => {
    const innerEffect = inner();
    const alpha = new AlphaFilter({ alpha: 1 });

    const innerFilters: Filter[] = Array.isArray(innerEffect.filter)
      ? innerEffect.filter
      : [innerEffect.filter];

    const wrapped: Effect<H> = {
      filter: [...innerFilters, alpha],
      getIntensity: () => alpha.alpha,
      setIntensity: (value) => {
        alpha.alpha = Math.max(0, Math.min(1, value));
      },
    };
    if (innerEffect.onAttach) {
      wrapped.onAttach = innerEffect.onAttach;
    }
    if (innerEffect.onDetach) {
      wrapped.onDetach = innerEffect.onDetach;
    }
    if (innerEffect.buildExtras) {
      wrapped.buildExtras = innerEffect.buildExtras;
    }
    return wrapped;
  };
}
