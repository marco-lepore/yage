/**
 * A live, compacted projection of one {@link Inventory}'s stacks — a subset
 * presented as its own {@link InventorySource}, so a hotbar can show only
 * usable items while staying a mirror of the same backpack (an add/use in
 * either surface is the same mutation, because it is one model).
 */
import { Emitter } from "./emitter.js";
import type { ItemCatalog } from "./catalog.js";
import type { Inventory } from "./Inventory.js";
import type { StackComparator } from "./comparators.js";
import type { InventorySource } from "./InventorySource.js";
import type {
  ActionResult,
  InstanceDataMap,
  InventoryEvents,
  ItemActionDef,
  ItemDef,
  ItemStack,
  LooseDataMap,
} from "./types.js";

/** Selects which of `inventory`'s stacks {@link filteredView} presents.
 *  Mirrors `InventoryOptions.accepts`, plus the stack itself for
 *  data-dependent filters (durability, rolled stats). */
export type SourceFilter<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> = (stack: ItemStack<TId, TData>, def: ItemDef<TId>) => boolean;

/** A {@link filteredView} projection: the {@link InventorySource} surface plus
 *  the escape hatches back to the underlying model. */
export interface FilteredInventoryView<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> extends InventorySource<TId, TData> {
  /** The model this view projects. */
  readonly source: Inventory<TId, TData>;
  /** The model slot behind presented index `i`, or `undefined` past the end
   *  of the projection — the escape hatch back to model space. */
  modelSlot(presentedIndex: number): number | undefined;
}

/**
 * Project `inventory`'s stacks matching `predicate` into a dense,
 * hole-free {@link InventorySource}. `capacity` is always `undefined` (the
 * view has no size of its own); `used` is the filtered count; `getActions`/
 * `invokeAction` take PRESENTED indices, remapped to the model slot
 * underneath; `sort` forwards to the whole model (one shared array — a
 * projection can't reorder only its subset).
 *
 * The projection recomputes on every read — cheap at the inventory sizes this
 * addon targets — and only subscribes to the model's own `"changed"` while at
 * least one listener is attached to the view's own `"changed"` (refcounted),
 * so a handful of pre-built, currently-inactive tab views cost nothing beyond
 * existing.
 */
export function filteredView<TId extends string, TData extends InstanceDataMap<TId> = LooseDataMap<TId>>(
  inventory: Inventory<TId, TData>,
  predicate: SourceFilter<TId, TData>,
): FilteredInventoryView<TId, TData> {
  return new FilteredView(inventory, predicate);
}

class FilteredView<TId extends string, TData extends InstanceDataMap<TId>>
  implements FilteredInventoryView<TId, TData>
{
  readonly source: Inventory<TId, TData>;
  private readonly predicate: SourceFilter<TId, TData>;
  private readonly emitter = new Emitter<Pick<InventoryEvents<TId>, "changed">>();
  private listenerCount = 0;
  private modelUnsub: (() => void) | undefined;

  constructor(source: Inventory<TId, TData>, predicate: SourceFilter<TId, TData>) {
    this.source = source;
    this.predicate = predicate;
  }

  /** Presented index → model slot, in slot order. Recomputed on every call —
   *  there is no cache to invalidate. */
  private map(): number[] {
    const out: number[] = [];
    const slots = this.source.slots;
    for (let i = 0; i < slots.length; i++) {
      const stack = slots[i];
      if (stack && this.predicate(stack, this.source.catalog.get(stack.itemId))) out.push(i);
    }
    return out;
  }

  get slots(): ReadonlyArray<ItemStack<TId, TData> | null> {
    return this.map().map((modelSlot) => this.source.slots[modelSlot] ?? null);
  }

  get capacity(): number | undefined {
    return undefined;
  }

  get used(): number {
    return this.map().length;
  }

  get catalog(): ItemCatalog<TId, TData> {
    return this.source.catalog;
  }

  modelSlot(presentedIndex: number): number | undefined {
    return this.map()[presentedIndex];
  }

  getActions(slot: number): readonly ItemActionDef<TId, TData>[] {
    const modelSlot = this.modelSlot(slot);
    return modelSlot === undefined ? [] : this.source.getActions(modelSlot);
  }

  invokeAction(actionId: string, slot: number): ActionResult {
    const modelSlot = this.modelSlot(slot);
    return modelSlot === undefined
      ? { ok: false, reason: "empty" }
      : this.source.invokeAction(actionId, modelSlot);
  }

  sort(comparator?: StackComparator<TId, TData>, opts?: { readonly consolidate?: boolean }): void {
    this.source.sort(comparator, opts);
  }

  on<K extends keyof InventoryEvents<TId>>(
    event: K,
    fn: (payload: InventoryEvents<TId>[K]) => void,
  ): () => void {
    // Every other event is a raw model fact (an item id/quantity, not a
    // presented position) — forward it verbatim, no remapping.
    if (event !== "changed") return this.source.on(event, fn);
    if (this.listenerCount === 0) {
      this.modelUnsub = this.source.on("changed", () => this.emitter.emit("changed", { slots: [] }));
    }
    this.listenerCount++;
    // The view's own "changed" carries no payload sessions read (they only
    // use it as a re-render signal) — cast at this one boundary.
    const unsub = this.emitter.on("changed", fn as (payload: InventoryEvents<TId>["changed"]) => void);
    return () => {
      unsub();
      if (--this.listenerCount === 0) {
        this.modelUnsub?.();
        this.modelUnsub = undefined;
      }
    };
  }
}
