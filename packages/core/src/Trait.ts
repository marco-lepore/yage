import type { Entity } from "./Entity.js";

/**
 * Trait system — discoverable, type-safe entity capabilities.
 *
 * Traits let entity subclasses declare capabilities (`Interactable`, `Damageable`)
 * that are enforced at compile time (via decorator constraint) and queryable at
 * runtime via `hasTrait()`.
 */

/** Symbol key for storing the set of trait symbols on a class. */
export const TRAITS_KEY = Symbol("TRAITS_KEY");

/**
 * A phantom-typed token representing a trait.
 * Follows the same pattern as EventToken / ServiceKey.
 */
export class TraitToken<T> {
  readonly symbol: symbol;

  constructor(
    /** Human-readable name for debugging. */
    public readonly name: string,
  ) {
    this.symbol = Symbol(`Trait:${name}`);
  }

  /** Phantom field to preserve the generic type. */
  declare readonly _type: T;
}

/**
 * Create a typed trait token.
 *
 * ```ts
 * const Interactable = defineTrait<{ interact(): void; priority: number }>("Interactable");
 * ```
 */
export function defineTrait<T>(name: string): TraitToken<T> {
  return new TraitToken<T>(name);
}

type EntityClass = abstract new (...args: never[]) => Entity;

type TraitClass = EntityClass & {
  [TRAITS_KEY]?: ReadonlySet<symbol>;
};

/** Check whether an entity class declares or inherits a trait. */
export function entityClassHasTrait<T>(
  target: EntityClass,
  token: TraitToken<T>,
): boolean {
  let current: TraitClass | null = target as TraitClass;
  while (current) {
    if (current[TRAITS_KEY]?.has(token.symbol)) return true;
    current = Object.getPrototypeOf(current) as TraitClass | null;
  }
  return false;
}

/**
 * Class decorator that registers a trait on an entity subclass.
 * The type constraint enforces that the class implements all trait members.
 *
 * ```ts
 * @trait(Interactable)
 * class LightEntity extends Entity {
 *   priority = 4;
 *   interact() { ... } // TS error if missing
 * }
 * ```
 */
export function trait<Trait>(token: TraitToken<Trait>) {
  return <T extends typeof Entity & { prototype: Trait }>(target: T): T => {
    const traitSymbols = new Set(target[TRAITS_KEY] ?? []);
    traitSymbols.add(token.symbol);
    target[TRAITS_KEY] = traitSymbols;

    return target;
  };
}
