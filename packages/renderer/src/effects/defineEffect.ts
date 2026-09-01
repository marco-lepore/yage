import type { Effect, EffectFactory } from "./Effect.js";
import type { EffectHandle } from "./EffectHandle.js";

/**
 * Symbol-keyed metadata stamped onto each effect built from a definition so
 * `EffectsHost.findEffect()` can match it without changing the public Effect
 * interface.
 *
 * @internal
 */
export const EFFECT_META = Symbol("yage.effectMeta");

/** Definition metadata recorded on a tagged `Effect`. @internal */
export interface EffectMeta {
  readonly definitionName: string;
}

/**
 * Registered effect definition. The callable shape `(options) => EffectFactory`
 * is what users invoke at call sites (`bloom({ threshold: 0.8 })`); the
 * `name` property lets callers find an attached effect later.
 */
export interface EffectDefinition<H extends EffectHandle, O> {
  (options: O): EffectFactory<H>;
  readonly name: string;
}

/**
 * Define a named effect preset. The returned callable accepts the preset's
 * options and yields an `EffectFactory` whose built effect carries the name
 * used by `EffectsHost.findEffect()`.
 *
 * Names are conventionally prefixed (`yage:hitFlash`, `yage:bloom`, …); the
 * `@yagejs/effects` package uses `yage:` for its hero presets.
 *
 */
export function defineEffect<H extends EffectHandle, O>(spec: {
  name: string;
  factory: (options: O) => Effect<H>;
}): EffectDefinition<H, O> {
  const definition = ((options: O): EffectFactory<H> => {
    return () => {
      const effect = spec.factory(options);
      const meta: EffectMeta = {
        definitionName: spec.name,
      };
      Object.defineProperty(effect, EFFECT_META, {
        value: meta,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      return effect;
    };
  }) as EffectDefinition<H, O>;
  Object.defineProperty(definition, "name", {
    value: spec.name,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return definition;
}

/** Read definition metadata stamped on an `Effect`, if any. @internal */
export function getEffectMeta(effect: Effect): EffectMeta | undefined {
  return (effect as unknown as Record<symbol, EffectMeta | undefined>)[
    EFFECT_META
  ];
}
