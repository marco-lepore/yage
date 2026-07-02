/**
 * The item catalog: the game's item definitions, validated and frozen once.
 * `defineItems` derives each id from its map key, so ids exist exactly once
 * (the key) and the returned catalog is typed over the literal id union —
 * `inv.add("potino")` is a compile error, not a runtime surprise.
 */

import type { ItemDef, ItemDefInput } from "./types.js";

/**
 * Validated, frozen item definitions plus their authoring order (the default
 * sort key — "the order you declared them" is the pokédex-style order games
 * sort by). Create one with {@link defineItems}.
 */
export class ItemCatalog<TId extends string = string> {
  private readonly byId: ReadonlyMap<TId, ItemDef<TId>>;
  /** Ids in authoring order. */
  readonly ids: readonly TId[];

  /** @internal — use {@link defineItems}. */
  constructor(defs: ReadonlyMap<TId, ItemDef<TId>>) {
    this.byId = defs;
    this.ids = [...defs.keys()];
  }

  /** The def for `id`. Throws on an unknown id — stacks only enter the model
   *  through catalog-checked paths, so an unknown id here is a programming
   *  error, not a data condition. */
  get(id: TId): ItemDef<TId> {
    const def = this.byId.get(id);
    if (!def) throw new Error(`unknown item id "${id}" — not in this catalog`);
    return def;
  }

  /** The def for `id`, or `undefined` — for ids from untrusted sources
   *  (snapshots, network) before they enter the model. */
  tryGet(id: string): ItemDef<TId> | undefined {
    return this.byId.get(id as TId);
  }

  /** Whether `id` is declared — narrows a plain string to this catalog's ids. */
  has(id: string): id is TId {
    return this.byId.has(id as TId);
  }

  /** Authoring position of `id` (the {@link byCatalogOrder} sort key). */
  orderOf(id: TId): number {
    return this.ids.indexOf(id);
  }

  /** All defs, in authoring order. */
  defs(): readonly ItemDef<TId>[] {
    return this.ids.map((id) => this.get(id));
  }
}

/**
 * Build an {@link ItemCatalog} from a map of definitions — the id IS the key:
 *
 * ```ts
 * const catalog = defineItems({
 *   potion: { name: "Potion", maxStack: 5, category: "consumable" },
 *   sword: { name: "Iron Sword", category: "gear" },
 *   arrows: { name: "Arrows", maxStack: 30, stacking: "single" },
 * });
 * ```
 *
 * Validates each def (non-empty name, integer `maxStack ≥ 1`) and freezes it.
 * The returned catalog's id type is the literal key union, which flows through
 * `Inventory<TId>` so item ids are checked at compile time.
 */
export function defineItems<const TDefs extends Record<string, ItemDefInput>>(
  defs: TDefs,
): ItemCatalog<Extract<keyof TDefs, string>> {
  type TId = Extract<keyof TDefs, string>;
  const out = new Map<TId, ItemDef<TId>>();
  for (const [id, input] of Object.entries(defs) as [TId, ItemDefInput][]) {
    if (!input.name) throw new Error(`item "${id}": name is required`);
    if (input.maxStack !== undefined) {
      if (!Number.isInteger(input.maxStack) || input.maxStack < 1) {
        throw new Error(
          `item "${id}": maxStack must be an integer ≥ 1 (got ${input.maxStack})`,
        );
      }
    }
    out.set(id, Object.freeze({ ...input, id }));
  }
  return new ItemCatalog(out);
}
