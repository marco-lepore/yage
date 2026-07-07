/**
 * The read + act + subscribe surface {@link InventorySession} drives: narrower
 * than {@link Inventory} itself — no `add`/`remove`/`transfer`/`find`, since a
 * projected source ({@link filteredView}) can't answer questions about slots
 * outside its own subset. `Inventory` implements this directly (the raw model
 * is a valid source — the identity projection, "all items").
 */
import type { ItemCatalog } from "./catalog.js";
import type { StackComparator } from "./comparators.js";
import type {
  ActionResult,
  InstanceDataMap,
  InventoryEvents,
  ItemActionDef,
  ItemStack,
  LooseDataMap,
} from "./types.js";

export interface InventorySource<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  /** Slot array, `null` for empty slots. Hole-free for a projected source. */
  readonly slots: ReadonlyArray<ItemStack<TId, TData> | null>;
  /** Max slot count, or `undefined` for an unbounded source (every
   *  {@link filteredView} — it has no fixed size, the model does). */
  readonly capacity: number | undefined;
  /** Occupied slot count. */
  readonly used: number;
  readonly catalog: ItemCatalog<TId, TData>;
  /** Subscribe to a source event; returns an unsubscribe. */
  on<K extends keyof InventoryEvents<TId>>(
    event: K,
    fn: (payload: InventoryEvents<TId>[K]) => void,
  ): () => void;
  /** The actions currently offered for the stack at `slot` (empty for an
   *  empty slot). */
  getActions(slot: number): readonly ItemActionDef<TId, TData>[];
  /** Invoke an action on the stack at `slot`. */
  invokeAction(actionId: string, slot: number): ActionResult;
  /** Sort/consolidate the source. A {@link filteredView} forwards this to its
   *  whole underlying model — a projection can't reorder only its subset. */
  sort(comparator?: StackComparator<TId, TData>, opts?: { readonly consolidate?: boolean }): void;
}
