import type { Effect, EffectFactory } from "./Effect.js";
import type { EffectHandle } from "./EffectHandle.js";

/**
 * Symbol-keyed metadata stamped onto each `Effect` built from a registered
 * definition. Used by `EffectStack.serialize()` to record `{ name, options }`
 * without polluting the public `Effect` interface; consumers should not read
 * or write this property directly.
 *
 * @internal
 */
export const EFFECT_META = Symbol("yage.effectMeta");

/** Snapshot-time metadata recorded on a tagged `Effect`. @internal */
export interface EffectMeta {
  readonly definitionName: string;
  readonly options: unknown;
}

/**
 * Registered effect definition. The callable shape `(options) => EffectFactory`
 * is what users invoke at call sites (`bloom({ threshold: 0.8 })`); the
 * `name` property is the registry key used for save/restore lookups.
 */
export interface EffectDefinition<H extends EffectHandle, O> {
  (options: O): EffectFactory<H>;
  readonly name: string;
}

/** Internal registry entry. @internal */
interface RegisteredEffect {
  readonly name: string;
  readonly factory: (options: unknown) => Effect<EffectHandle>;
}

const registry = new Map<string, RegisteredEffect>();

/**
 * Register an effect preset under a stable string `name` so its `EffectStack`
 * entries survive save/load. The returned callable accepts the preset's
 * options and yields an `EffectFactory` whose built `Effect` is tagged with
 * `{ name, options }` for serialization.
 *
 * Names are conventionally prefixed (`yage:hitFlash`, `yage:bloom`, …); the
 * `@yagejs/effects` package uses `yage:` for its hero presets.
 *
 * Re-registering an existing name overwrites the previous entry and emits a
 * dev warning — typically only happens during HMR.
 */
export function defineEffect<H extends EffectHandle, O>(spec: {
  name: string;
  factory: (options: O) => Effect<H>;
}): EffectDefinition<H, O> {
  if (registry.has(spec.name)) {
    console.warn(
      `defineEffect: re-registering "${spec.name}" — previous definition replaced.`,
    );
  }
  registry.set(spec.name, {
    name: spec.name,
    factory: spec.factory as (options: unknown) => Effect<EffectHandle>,
  });

  const definition = ((options: O): EffectFactory<H> => {
    return () => {
      const effect = spec.factory(options);
      const meta: EffectMeta = { definitionName: spec.name, options };
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

/** Read snapshot metadata stamped on an `Effect`, if any. @internal */
export function getEffectMeta(effect: Effect): EffectMeta | undefined {
  return (effect as unknown as Record<symbol, EffectMeta | undefined>)[
    EFFECT_META
  ];
}

/** Look up a registered effect definition by name. @internal */
export function getRegisteredEffect(name: string): RegisteredEffect | undefined {
  return registry.get(name);
}

/** @internal — test-only registry reset. */
export function _resetEffectRegistry(): void {
  registry.clear();
}
