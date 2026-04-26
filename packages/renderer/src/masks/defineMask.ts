import type { Mask, MaskFactory } from "./MaskFactory.js";

/**
 * Symbol-keyed metadata stamped onto each `Mask` built from a registered
 * definition. Used by {@link attachMask} so the resulting handle can serialize
 * itself; consumers should not read or write this property directly.
 *
 * @internal
 */
export const MASK_META = Symbol("yage.maskMeta");

/** Snapshot-time metadata recorded on a tagged `Mask`. @internal */
export interface MaskMeta {
  readonly definitionName: string;
  readonly options: unknown;
}

/**
 * Registered mask definition. Mirrors {@link EffectDefinition}. The callable
 * shape `(options) => MaskFactory` is what users invoke (`rectMask({ ... })`),
 * and the `name` property is the registry key for save/restore lookups.
 */
export interface MaskDefinition<O> {
  (options: O): MaskFactory;
  readonly name: string;
}

/** Internal registry entry. @internal */
interface RegisteredMask {
  readonly name: string;
  readonly factory: (options: unknown) => Mask;
}

const registry = new Map<string, RegisteredMask>();

/**
 * Register a mask preset under a stable string `name` so masks attached
 * through it survive save/load. The returned callable accepts the mask's
 * options and yields a `MaskFactory` whose built `Mask` is tagged with
 * `{ name, options }` for serialization.
 *
 * `spriteMask` and `graphicsMask` intentionally do not register: a saved
 * `Sprite` reference or draw closure has no string identity, so the saved
 * snapshot cannot rebuild them.
 */
export function defineMask<O>(spec: {
  name: string;
  factory: (options: O) => Mask;
}): MaskDefinition<O> {
  if (registry.has(spec.name)) {
    console.warn(
      `defineMask: re-registering "${spec.name}" — previous definition replaced.`,
    );
  }
  registry.set(spec.name, {
    name: spec.name,
    factory: spec.factory as (options: unknown) => Mask,
  });

  const definition = ((options: O): MaskFactory => {
    return () => {
      const mask = spec.factory(options);
      // Snapshot the options at attach time so a caller who later mutates
      // the same POJO doesn't poison the metadata used by save/restore.
      const meta: MaskMeta = {
        definitionName: spec.name,
        options: structuredClone(options),
      };
      Object.defineProperty(mask, MASK_META, {
        value: meta,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      return mask;
    };
  }) as MaskDefinition<O>;
  Object.defineProperty(definition, "name", {
    value: spec.name,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return definition;
}

/** Read snapshot metadata stamped on a `Mask`, if any. @internal */
export function getMaskMeta(mask: Mask): MaskMeta | undefined {
  return (mask as unknown as Record<symbol, MaskMeta | undefined>)[MASK_META];
}

/** Look up a registered mask definition by name. @internal */
export function getRegisteredMask(name: string): RegisteredMask | undefined {
  return registry.get(name);
}

/** @internal — test-only registry reset. */
export function _resetMaskRegistry(): void {
  registry.clear();
}
