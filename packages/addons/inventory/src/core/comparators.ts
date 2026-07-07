/**
 * Sort comparators for {@link Inventory.sort}. A comparator sees a
 * {@link SortEntry} — the stack, its def, and the def's catalog authoring
 * order — so orderings can mix state (quantity) and definition (name,
 * category) without a lookup. All built-ins tie-break by catalog order, and
 * the sort itself is stable, so equal entries keep their relative placement.
 */

import type { InstanceDataMap, ItemDef, ItemStack, LooseDataMap } from "./types.js";

/** What a {@link StackComparator} compares. */
export interface SortEntry<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  readonly stack: ItemStack<TId, TData>;
  readonly def: ItemDef<TId>;
  /** The def's authoring position in the catalog. */
  readonly order: number;
}

export type StackComparator<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> = (a: SortEntry<TId, TData>, b: SortEntry<TId, TData>) => number;

/** Catalog authoring order — the default (`defineItems` declaration order). */
export const byCatalogOrder: StackComparator = (a, b) => a.order - b.order;

/** Display name, ascending. */
export const byName: StackComparator = (a, b) =>
  a.def.name < b.def.name ? -1 : a.def.name > b.def.name ? 1 : a.order - b.order;

/** Category ascending (undefined categories last), then catalog order. */
export const byCategory: StackComparator = (a, b) => {
  const ca = a.def.category;
  const cb = b.def.category;
  if (ca !== cb) {
    if (ca === undefined) return 1;
    if (cb === undefined) return -1;
    return ca < cb ? -1 : 1;
  }
  return a.order - b.order;
};

/** Stack quantity, descending (big piles first), then catalog order. */
export const byQuantity: StackComparator = (a, b) =>
  b.stack.quantity - a.stack.quantity || a.order - b.order;
