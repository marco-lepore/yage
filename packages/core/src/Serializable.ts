/* eslint-disable @typescript-eslint/no-explicit-any -- Constructor types require `any` for TS decorator compatibility */

/** Symbol stored on classes decorated with @serializable. Holds the type string. */
export const SERIALIZABLE_KEY = Symbol("SERIALIZABLE");

/** Global registry mapping type strings to classes. */
const registry = new Map<string, new (...args: any[]) => any>();

/** Read-only access to the serializable type registry. */
export const SerializableRegistry = {
  /** Look up a class by its type string. */
  get(type: string): (new (...args: any[]) => any) | undefined {
    return registry.get(type);
  },
  /** Check if a type string is registered. */
  has(type: string): boolean {
    return registry.has(type);
  },
  /** Iterate all registered [type, class] entries. */
  entries(): IterableIterator<
    [string, new (...args: any[]) => any]
  > {
    return registry.entries();
  },
  /** Remove a type from the registry. */
  delete(type: string): boolean {
    return registry.delete(type);
  },
};

/** Check if an instance belongs to a @serializable-decorated class. */
export function isSerializable(instance: object): boolean {
  return SERIALIZABLE_KEY in instance.constructor;
}

/** Get the type string from a @serializable-decorated class or instance. */
export function getSerializableType(
  target: object | (new (...args: any[]) => any),
): string | undefined {
  const ctor = typeof target === "function" ? target : target.constructor;
  return (ctor as unknown as Record<symbol, string>)[SERIALIZABLE_KEY];
}

/**
 * Decorator that registers a class in the global SerializableRegistry.
 *
 * Works on Component, Entity, and Scene subclasses.
 *
 * ```ts
 * // Zero-arg — uses class.name as type string
 * @serializable
 * class Transform extends Component { ... }
 *
 * // With override — for name collisions or minified builds
 * @serializable({ type: "MyTransform" })
 * class Transform extends Component { ... }
 * ```
 */
export function serializable<
  T extends new (...args: any[]) => any,
>(target: T): T;
export function serializable(
  config: { type: string },
): <T extends new (...args: any[]) => any>(target: T) => T;
export function serializable(
  targetOrConfig:
    | (new (...args: any[]) => any)
    | { type: string },
) {
  if (typeof targetOrConfig === "function") {
    // Called as @serializable (no args)
    const target = targetOrConfig;
    const type = target.name;
    (target as unknown as Record<symbol, string>)[SERIALIZABLE_KEY] = type;
    registry.set(type, target);
    return target;
  }
  // Called as @serializable({ type: "..." })
  const config = targetOrConfig;
  return <T extends new (...args: any[]) => any>(target: T): T => {
    (target as unknown as Record<symbol, string>)[SERIALIZABLE_KEY] =
      config.type;
    registry.set(config.type, target);
    return target;
  };
}
