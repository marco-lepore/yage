import type { Mask, MaskFactory } from "./MaskFactory.js";

/**
 * Named mask definition. Mirrors {@link EffectDefinition}. The callable
 * shape `(options) => MaskFactory` is what users invoke (`rectMask({ ... })`).
 */
export interface MaskDefinition<O> {
  (options: O): MaskFactory;
  readonly name: string;
}

/**
 * Define a named mask preset. The returned callable accepts the preset's
 * options and yields a `MaskFactory`.
 */
export function defineMask<O>(spec: {
  name: string;
  factory: (options: O) => Mask;
}): MaskDefinition<O> {
  const definition = ((options: O): MaskFactory => {
    return () => spec.factory(options);
  }) as MaskDefinition<O>;
  Object.defineProperty(definition, "name", {
    value: spec.name,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return definition;
}
