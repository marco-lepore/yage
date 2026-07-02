/**
 * Inventory — the headless model: a slot array of {@link ItemStack}s plus the
 * operations games keep rewriting (stack merge on add, partial acceptance,
 * move/merge/swap, split, consolidate-and-sort, cross-inventory transfer,
 * snapshot round-trip).
 *
 * It is always live: the UI session/presenters are OBSERVERS of this object,
 * so game logic reads and mutates it whether or not any inventory screen is
 * open ("has the gold key?" is `inv.has("goldKey")`, not a UI question).
 *
 * Rules in, consequences out: what may enter (`accepts`, `constraints`,
 * stacking modes) is injected policy; what an action DOES (heal, drop) is the
 * game's, reached through the `"action"` event. The model never interprets
 * game meaning.
 *
 * Failure conventions: interaction operations REPORT (`add`/`transfer` return
 * result objects, `move` a kind, `split`/`invokeAction` a boolean — a refused
 * player gesture is a normal outcome); only the raw escape hatch `setSlot`
 * and invalid arguments (non-positive quantities) THROW.
 */

import { Emitter } from "./emitter.js";
import type { ItemCatalog } from "./catalog.js";
import { byCatalogOrder, type SortEntry, type StackComparator } from "./comparators.js";
import type {
  AddResult,
  InventoryConstraint,
  InventoryEvents,
  InventoryReader,
  InventorySnapshot,
  ItemActionDef,
  ItemDef,
  ItemStack,
  ItemStackSnapshot,
  MoveKind,
  RejectReason,
  RemoveResult,
  TransferResult,
} from "./types.js";

export interface InventoryOptions<TId extends string = string> {
  readonly catalog: ItemCatalog<TId>;
  /** Max slot count. Omit for an unbounded inventory (key items, quest logs) —
   *  the slot array grows as stacks land. */
  readonly capacity?: number;
  /**
   * Close gaps automatically when a slot empties (list-style inventories with
   * no holes). Applies to REMOVALS only — `move`/`split` are explicit
   * arrangement and never trigger it. Default `false` (grid-style: an emptied
   * cell stays empty).
   */
  readonly autoCompact?: boolean;
  /** `maxStack` for defs that don't declare one. Default 1 (unstackable
   *  unless the def opts in). */
  readonly defaultMaxStack?: number;
  /** Section filter: refuse items this inventory doesn't hold (a key-items
   *  pouch accepts only `category: "key"`). Refusals emit `rejected`
   *  (`"filtered"`). */
  readonly accepts?: (def: ItemDef<TId>) => boolean;
  /** Additional acceptance limits (weight, currency caps) — see
   *  {@link InventoryConstraint}. Slot capacity needs no constraint. */
  readonly constraints?: readonly InventoryConstraint<TId>[];
  /** The actions items can offer ("Use", "Drop", …). Per-item applicability
   *  via `ItemDef.actions` + each action's `available`. */
  readonly actions?: readonly ItemActionDef<TId>[];
}

export class Inventory<TId extends string = string> implements InventoryReader<TId> {
  readonly catalog: ItemCatalog<TId>;
  readonly capacity: number | undefined;

  private readonly autoCompact: boolean;
  private readonly defaultMaxStack: number;
  private readonly acceptsFn: ((def: ItemDef<TId>) => boolean) | undefined;
  private readonly constraints: readonly InventoryConstraint<TId>[];
  private readonly actions: readonly ItemActionDef<TId>[];
  private readonly emitter = new Emitter<InventoryEvents<TId>>();
  private readonly _slots: (ItemStack<TId> | null)[];

  constructor(opts: InventoryOptions<TId>) {
    if (opts.capacity !== undefined && (!Number.isInteger(opts.capacity) || opts.capacity < 1)) {
      throw new Error(`capacity must be an integer ≥ 1 (got ${opts.capacity})`);
    }
    this.catalog = opts.catalog;
    this.capacity = opts.capacity;
    this.autoCompact = opts.autoCompact ?? false;
    this.defaultMaxStack = opts.defaultMaxStack ?? 1;
    this.acceptsFn = opts.accepts;
    this.constraints = opts.constraints ?? [];
    this.actions = opts.actions ?? [];
    // Bounded inventories keep a fixed-length array (empty = null) so slot
    // indices are stable grid cells; unbounded ones grow/shrink.
    this._slots = opts.capacity !== undefined ? new Array<ItemStack<TId> | null>(opts.capacity).fill(null) : [];
  }

  // ---------------------------------------------------------------- reading

  get slots(): ReadonlyArray<ItemStack<TId> | null> {
    return this._slots;
  }

  get used(): number {
    let n = 0;
    for (const s of this._slots) if (s) n++;
    return n;
  }

  /** Bounded and no empty slot left. An unbounded inventory is never full. */
  get isFull(): boolean {
    return this.capacity !== undefined && this.used >= this.capacity;
  }

  /** The stack at `slot`, or `null` (empty or out of range). */
  get(slot: number): ItemStack<TId> | null {
    return this._slots[slot] ?? null;
  }

  /**
   * Total units of `itemId`. Counts data-carrying stacks too — pass
   * `{ dataless: true }` to count only what anonymous {@link remove} /
   * {@link transfer} can take, so a `has → remove` guard matches the removal.
   */
  count(itemId: TId, opts: { readonly dataless?: boolean } = {}): number {
    let n = 0;
    for (const s of this._slots) {
      if (s && s.itemId === itemId && !(opts.dataless && s.data)) n += s.quantity;
    }
    return n;
  }

  /** Whether at least `quantity` units of `itemId` are held. Same
   *  `{ dataless: true }` filter as {@link count}. */
  has(itemId: TId, quantity = 1, opts: { readonly dataless?: boolean } = {}): boolean {
    return this.count(itemId, opts) >= quantity;
  }

  /** Index of the first stack of `itemId`, or `undefined`. */
  firstSlot(itemId: TId): number | undefined {
    const i = this._slots.findIndex((s) => s !== null && s.itemId === itemId);
    return i === -1 ? undefined : i;
  }

  /** Every occupied slot, in slot order. */
  stacks(): ReadonlyArray<{ readonly slot: number; readonly stack: ItemStack<TId> }> {
    const out: { slot: number; stack: ItemStack<TId> }[] = [];
    this._slots.forEach((stack, slot) => {
      if (stack) out.push({ slot, stack });
    });
    return out;
  }

  /** Subscribe to a model event; returns an unsubscribe. */
  on<K extends keyof InventoryEvents<TId>>(
    event: K,
    fn: (payload: InventoryEvents<TId>[K]) => void,
  ): () => void {
    return this.emitter.on(event, fn);
  }

  // ---------------------------------------------------------------- adding

  /**
   * Add `quantity` units, merging into open stacks first ("multi") or topping
   * up the single capped stack ("single"). Partial acceptance is normal: the
   * result says how much landed, what was refused and why. Pass `data` for a
   * per-stack payload — data stacks never merge, they open fresh slots.
   */
  add(
    itemId: TId,
    quantity = 1,
    opts: { readonly data?: Readonly<Record<string, unknown>> } = {},
  ): AddResult {
    assertPositiveInt(quantity, "quantity");
    const def = this.catalog.get(itemId);

    if (this.acceptsFn && !this.acceptsFn(def)) {
      return this.reject(itemId, quantity, "filtered");
    }

    // Constraints clip the request before placement (weight, caps, …). A
    // constraint returning NaN is a broken policy — treated as 0 so the add
    // rejects loudly (via the rejected event) instead of poisoning the result.
    let allowed = quantity;
    let reason: RejectReason | undefined;
    let constraintId: string | undefined;
    for (const c of this.constraints) {
      const raw = c.maxAcceptable(def, this);
      const cap = Number.isNaN(raw) ? 0 : Math.max(0, Math.floor(raw));
      if (cap < allowed) {
        allowed = cap;
        reason = "constraint";
        constraintId = c.id;
      }
    }
    if (allowed === 0) return this.reject(itemId, quantity, "constraint", constraintId);

    const maxStack = def.maxStack ?? this.defaultMaxStack;
    const placed =
      (def.stacking ?? "multi") === "single"
        ? this.placeSingle(itemId, allowed, maxStack, opts.data)
        : this.placeMulti(itemId, allowed, maxStack, opts.data);
    if (placed.added < allowed) reason ??= placed.reason;

    const rejected = quantity - placed.added;
    const rejectMeta =
      reason === "constraint" && constraintId !== undefined ? { constraintId } : {};
    if (placed.added > 0) {
      this.emitter.emit("itemAdded", {
        itemId,
        quantity: placed.added,
        slots: placed.slots,
      });
    }
    if (rejected > 0) {
      this.emitter.emit("rejected", {
        itemId,
        quantity: rejected,
        reason: reason ?? "capacity",
        ...rejectMeta,
      });
    }
    if (placed.slots.length > 0) this.emitChanged(placed.slots);
    return {
      added: placed.added,
      rejected,
      slots: placed.slots,
      ...(rejected > 0 ? { reason: reason ?? "capacity", ...rejectMeta } : {}),
    };
  }

  /** "multi": top up existing dataless stacks, then open new slots. */
  private placeMulti(
    itemId: TId,
    amount: number,
    maxStack: number,
    data: Readonly<Record<string, unknown>> | undefined,
  ): { added: number; slots: number[]; reason?: RejectReason } {
    const slots: number[] = [];
    let remaining = amount;

    if (!data) {
      for (let i = 0; i < this._slots.length && remaining > 0; i++) {
        const s = this._slots[i];
        if (!s || s.itemId !== itemId || s.data || s.quantity >= maxStack) continue;
        const take = Math.min(remaining, maxStack - s.quantity);
        this._slots[i] = { itemId, quantity: s.quantity + take };
        remaining -= take;
        slots.push(i);
      }
    }

    while (remaining > 0) {
      const slot = this.openSlot();
      if (slot === undefined) {
        return { added: amount - remaining, slots, reason: "capacity" };
      }
      const take = Math.min(remaining, maxStack);
      this._slots[slot] = { itemId, quantity: take, ...(data ? { data } : {}) };
      remaining -= take;
      slots.push(slot);
    }
    return { added: amount, slots };
  }

  /** "single": one stack total, `maxStack` is the item's cap. A data payload
   *  can't merge, so it only lands when the item isn't held at all. */
  private placeSingle(
    itemId: TId,
    amount: number,
    maxStack: number,
    data: Readonly<Record<string, unknown>> | undefined,
  ): { added: number; slots: number[]; reason?: RejectReason } {
    const held = this.count(itemId);
    if (data && held > 0) return { added: 0, slots: [], reason: "stack-cap" };
    const space = maxStack - held;
    if (space <= 0) return { added: 0, slots: [], reason: "stack-cap" };
    const take = Math.min(amount, space);
    const reason: RejectReason | undefined = take < amount ? "stack-cap" : undefined;

    const existing = this.firstSlot(itemId);
    if (existing !== undefined) {
      const s = this._slots[existing]!;
      this._slots[existing] = { ...s, quantity: s.quantity + take };
      return { added: take, slots: [existing], ...(reason ? { reason } : {}) };
    }
    const slot = this.openSlot();
    if (slot === undefined) return { added: 0, slots: [], reason: "capacity" };
    this._slots[slot] = { itemId, quantity: take, ...(data ? { data } : {}) };
    return { added: take, slots: [slot], ...(reason ? { reason } : {}) };
  }

  /** First empty slot; unbounded inventories append. */
  private openSlot(): number | undefined {
    const i = this._slots.indexOf(null);
    if (i !== -1) return i;
    if (this.capacity === undefined) return this._slots.length;
    return undefined;
  }

  private reject(
    itemId: TId,
    quantity: number,
    reason: RejectReason,
    constraintId?: string,
  ): AddResult {
    const meta = constraintId !== undefined ? { constraintId } : {};
    this.emitter.emit("rejected", { itemId, quantity, reason, ...meta });
    return { added: 0, rejected: quantity, reason, slots: [], ...meta };
  }

  // -------------------------------------------------------------- removing

  /**
   * Remove up to `quantity` units of `itemId`, draining stacks from the LAST
   * slot backwards (tail piles empty first; organized early stacks survive).
   * Skips data-carrying stacks — instance stacks are removed explicitly via
   * {@link removeAt}, never as anonymous units. Guard with
   * `has(id, n, { dataless: true })` (plain `has` counts data stacks too, so
   * it can say yes to units this method won't take).
   */
  remove(itemId: TId, quantity = 1): RemoveResult {
    assertPositiveInt(quantity, "quantity");
    const touched: number[] = [];
    let remaining = quantity;
    for (let i = this._slots.length - 1; i >= 0 && remaining > 0; i--) {
      const s = this._slots[i];
      if (!s || s.itemId !== itemId || s.data) continue;
      const take = Math.min(remaining, s.quantity);
      this._slots[i] = take === s.quantity ? null : { ...s, quantity: s.quantity - take };
      remaining -= take;
      touched.push(i);
    }
    const removed = quantity - remaining;
    if (removed > 0) {
      this.emitter.emit("itemRemoved", { itemId, quantity: removed });
      this.emitChanged(this.maybeCompact(touched));
    }
    return { removed };
  }

  /** Remove `quantity` units (default: the whole stack) from one slot. */
  removeAt(slot: number, quantity?: number): RemoveResult {
    const s = this._slots[slot];
    if (!s) return { removed: 0 };
    if (quantity !== undefined) assertPositiveInt(quantity, "quantity");
    const take = Math.min(quantity ?? s.quantity, s.quantity);
    this._slots[slot] = take === s.quantity ? null : { ...s, quantity: s.quantity - take };
    this.emitter.emit("itemRemoved", { itemId: s.itemId, quantity: take });
    this.emitChanged(this.maybeCompact([slot]));
    return { removed: take };
  }

  /**
   * Raw slot write — the escape hatch under every convenience. Validates the
   * item id and quantity, then places the stack verbatim (no merging, no
   * capacity/constraint checks, no `itemAdded`/`itemRemoved` — just `changed`).
   */
  setSlot(slot: number, stack: ItemStack<TId> | null): void {
    if (slot < 0 || (this.capacity !== undefined && slot >= this.capacity)) {
      throw new Error(`slot ${slot} out of range`);
    }
    if (stack) {
      this.catalog.get(stack.itemId); // throws on an unknown id
      assertPositiveInt(stack.quantity, "stack.quantity");
    }
    this.growTo(slot);
    this._slots[slot] = stack;
    this.emitChanged([slot]);
  }

  /** Remove every stack. Emits a single `changed` (no per-item events — it's
   *  a bulk reset, not gameplay removal). */
  clear(): void {
    const affected = this.allIndices();
    if (this.capacity !== undefined) this._slots.fill(null);
    else this._slots.length = 0;
    this.emitChanged(affected);
  }

  // ------------------------------------------------------------- arranging

  /**
   * Player-style slot interaction: onto an empty slot → move; onto the same
   * dataless item → merge up to `maxStack` (leftover stays at `from`); onto
   * anything else (or a full same-item stack) → swap. Never auto-compacts —
   * this IS the player arranging things.
   */
  move(from: number, to: number): MoveKind {
    const src = this._slots[from];
    if (!src || from === to || to < 0) return "none";
    if (this.capacity !== undefined && to >= this.capacity) return "none";
    this.growTo(to);
    const dst = this._slots[to];

    if (!dst) {
      this._slots[to] = src;
      this._slots[from] = null;
      this.emitChanged([from, to]);
      return "moved";
    }

    const mergeable = dst.itemId === src.itemId && !dst.data && !src.data;
    if (mergeable) {
      const def = this.catalog.get(src.itemId);
      const maxStack = def.maxStack ?? this.defaultMaxStack;
      const take = Math.min(maxStack - dst.quantity, src.quantity);
      if (take > 0) {
        this._slots[to] = { ...dst, quantity: dst.quantity + take };
        this._slots[from] = take === src.quantity ? null : { ...src, quantity: src.quantity - take };
        this.emitChanged([from, to]);
        return "merged";
      }
      // Full target: fall through to a swap (the familiar chest-UI behavior).
    }

    this._slots[to] = src;
    this._slots[from] = dst;
    this.emitChanged([from, to]);
    return "swapped";
  }

  /**
   * Split `quantity` units off the stack at `from` into `to` (default: the
   * first empty slot). `quantity` must leave at least one unit behind (use
   * {@link move} to relocate a whole stack) and the target must be empty.
   * Returns false when any of that doesn't hold.
   */
  split(from: number, quantity: number, to?: number): boolean {
    assertPositiveInt(quantity, "quantity");
    const src = this._slots[from];
    if (!src || quantity >= src.quantity) return false;
    const target = to ?? this.openSlot();
    if (target === undefined || target < 0 || target === from) return false;
    if (this.capacity !== undefined && target >= this.capacity) return false;
    this.growTo(target);
    if (this._slots[target] !== null && this._slots[target] !== undefined) return false;

    this._slots[from] = { ...src, quantity: src.quantity - quantity };
    this._slots[target] = { ...src, quantity };
    this.emitChanged([from, target]);
    return true;
  }

  /** Close the gaps, preserving stack order. A no-op emits nothing. */
  compact(): void {
    const before = [...this._slots];
    const packed = this._slots.filter((s): s is ItemStack<TId> => s !== null);
    if (this.capacity !== undefined) {
      this._slots.fill(null);
      packed.forEach((s, i) => (this._slots[i] = s));
    } else {
      this._slots.length = 0;
      this._slots.push(...packed);
    }
    const affected: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== (this._slots[i] ?? null)) affected.push(i);
    }
    if (affected.length > 0) this.emitChanged(affected);
  }

  /**
   * Compact, consolidate, and order the stacks. `consolidate` (default true)
   * first re-packs partial dataless "multi" stacks of the same item into full
   * ones — the tidy-up players expect from a Sort button. Data stacks are
   * never consolidated; `comparator` defaults to {@link byCatalogOrder}.
   */
  sort(comparator: StackComparator<TId> = byCatalogOrder, opts: { readonly consolidate?: boolean } = {}): void {
    const affected = this.allIndices();
    let entries = this.sortEntries();
    if (opts.consolidate ?? true) entries = this.consolidate(entries);
    entries.sort(comparator);

    if (this.capacity !== undefined) {
      this._slots.fill(null);
      entries.forEach((e, i) => (this._slots[i] = e.stack));
    } else {
      this._slots.length = 0;
      this._slots.push(...entries.map((e) => e.stack));
    }
    this.emitChanged(affected.length > 0 ? affected : this.allIndices());
  }

  private sortEntries(): SortEntry<TId>[] {
    const out: SortEntry<TId>[] = [];
    for (const s of this._slots) {
      if (!s) continue;
      const def = this.catalog.get(s.itemId);
      out.push({ stack: s, def, order: this.catalog.orderOf(s.itemId) });
    }
    return out;
  }

  /** Merge partial dataless "multi" stacks per item into full `maxStack`
   *  chunks (first-appearance order preserved; data stacks pass through). */
  private consolidate(entries: SortEntry<TId>[]): SortEntry<TId>[] {
    const out: SortEntry<TId>[] = [];
    const totals = new Map<TId, { def: SortEntry<TId>["def"]; order: number; total: number }>();
    for (const e of entries) {
      if (e.stack.data || (e.def.stacking ?? "multi") === "single") {
        out.push(e);
        continue;
      }
      const agg = totals.get(e.stack.itemId);
      if (agg) agg.total += e.stack.quantity;
      else totals.set(e.stack.itemId, { def: e.def, order: e.order, total: e.stack.quantity });
    }
    for (const [itemId, agg] of totals) {
      const maxStack = agg.def.maxStack ?? this.defaultMaxStack;
      let left = agg.total;
      while (left > 0) {
        const q = Math.min(left, maxStack);
        out.push({ stack: { itemId, quantity: q }, def: agg.def, order: agg.order });
        left -= q;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ transfers

  /**
   * Move up to `quantity` dataless units of `itemId` into `target` (chest ↔
   * player). Only what the target accepts leaves the source, so a full or
   * filtering target can't destroy items. Data stacks don't move this way —
   * use {@link transferSlot}.
   */
  transfer(target: Inventory<TId>, itemId: TId, quantity = 1): TransferResult {
    assertPositiveInt(quantity, "quantity");
    if (target === (this as Inventory<TId>)) return { transferred: 0, rejected: 0 };
    let available = 0;
    for (const s of this._slots) {
      if (s && s.itemId === itemId && !s.data) available += s.quantity;
    }
    const ask = Math.min(quantity, available);
    if (ask === 0) return { transferred: 0, rejected: 0 };
    const res = target.add(itemId, ask);
    if (res.added > 0) this.remove(itemId, res.added);
    return {
      transferred: res.added,
      rejected: res.rejected,
      ...(res.reason ? { reason: res.reason } : {}),
    };
  }

  /** Move (part of) one specific stack — data payload included — into `target`. */
  transferSlot(target: Inventory<TId>, slot: number, quantity?: number): TransferResult {
    const s = this._slots[slot];
    if (!s || target === (this as Inventory<TId>)) return { transferred: 0, rejected: 0 };
    if (quantity !== undefined) assertPositiveInt(quantity, "quantity");
    const ask = Math.min(quantity ?? s.quantity, s.quantity);
    const res = target.add(s.itemId, ask, s.data ? { data: s.data } : {});
    if (res.added > 0) this.removeAt(slot, res.added);
    return {
      transferred: res.added,
      rejected: ask - res.added,
      ...(res.reason ? { reason: res.reason } : {}),
    };
  }

  // -------------------------------------------------------------- actions

  /** The actions currently offered for the stack at `slot` (empty for an
   *  empty slot): inventory actions, narrowed by `ItemDef.actions`, gated by
   *  each action's `available`. */
  getActions(slot: number): readonly ItemActionDef<TId>[] {
    const stack = this._slots[slot];
    if (!stack) return [];
    const def = this.catalog.get(stack.itemId);
    const ctx = { slot, stack, def, inventory: this as InventoryReader<TId> };
    return this.actions.filter(
      (a) => (def.actions ? def.actions.includes(a.id) : true) && (a.available?.(ctx) ?? true),
    );
  }

  /**
   * Invoke an action on the stack at `slot`. Emits the `"action"` event (the
   * game applies the consequence there), then removes one unit if the action
   * `consumes`. Returns false when the action isn't currently offered for
   * that slot.
   */
  invokeAction(actionId: string, slot: number): boolean {
    const action = this.getActions(slot).find((a) => a.id === actionId);
    const stack = this._slots[slot];
    if (!action || !stack) return false;
    this.emitter.emit("action", {
      actionId,
      slot,
      itemId: stack.itemId,
      quantity: stack.quantity,
      consumes: action.consumes ?? false,
    });
    if (action.consumes) this.removeAt(slot, 1);
    return true;
  }

  // ------------------------------------------------------------- snapshot

  /** JSON-able copy of the whole state — pair with {@link restore} for save
   *  systems (e.g. a `@yagejs/save` `SnapshotContributor`). */
  snapshot(): InventorySnapshot {
    return {
      slots: this._slots.map((s) =>
        s ? { itemId: s.itemId, quantity: s.quantity, ...(s.data ? { data: { ...s.data } } : {}) } : null,
      ),
    };
  }

  /**
   * Replace the state with `snapshot`. Entries the current catalog doesn't
   * declare, with invalid quantities, or beyond a bounded capacity are
   * DROPPED and returned — surface them however fits (log, "lost items"
   * mail); the model won't resurrect unknown ids.
   */
  restore(snapshot: InventorySnapshot): { readonly dropped: readonly ItemStackSnapshot[] } {
    const dropped: ItemStackSnapshot[] = [];
    const next: (ItemStack<TId> | null)[] = [];
    snapshot.slots.forEach((entry, i) => {
      if (!entry) {
        next.push(null);
        return;
      }
      const valid =
        this.catalog.has(entry.itemId) &&
        Number.isInteger(entry.quantity) &&
        entry.quantity >= 1 &&
        (this.capacity === undefined || i < this.capacity);
      if (!valid) {
        dropped.push(entry);
        next.push(null);
        return;
      }
      next.push({
        itemId: entry.itemId as TId,
        quantity: entry.quantity,
        ...(entry.data ? { data: { ...entry.data } } : {}),
      });
    });

    const affected = new Set<number>(this.allIndices());
    if (this.capacity !== undefined) {
      this._slots.fill(null);
      next.slice(0, this.capacity).forEach((s, i) => (this._slots[i] = s));
    } else {
      this._slots.length = 0;
      this._slots.push(...next);
      // Trailing empties carry no state in an unbounded inventory.
      while (this._slots.length > 0 && this._slots[this._slots.length - 1] === null) {
        this._slots.pop();
      }
    }
    for (const i of this.allIndices()) affected.add(i);
    this.emitChanged([...affected]);
    return { dropped };
  }

  // -------------------------------------------------------------- internals

  /** Ensure index `slot` exists in an unbounded array (fill gaps with null). */
  private growTo(slot: number): void {
    while (this._slots.length <= slot) this._slots.push(null);
  }

  private allIndices(): number[] {
    return this._slots.map((_, i) => i);
  }

  /** After removals: honor `autoCompact`, returning the final affected set. */
  private maybeCompact(touched: number[]): number[] {
    if (!this.autoCompact || !touched.some((i) => this._slots[i] === null)) return touched;
    const from = Math.min(...touched);
    const affected = new Set(touched);
    const packed = this._slots.filter((s): s is ItemStack<TId> => s !== null);
    if (this.capacity !== undefined) {
      this._slots.fill(null);
      packed.forEach((s, i) => (this._slots[i] = s));
      for (let i = from; i < this.capacity; i++) affected.add(i);
    } else {
      this._slots.length = 0;
      this._slots.push(...packed);
      for (let i = from; i <= packed.length; i++) affected.add(i);
    }
    return [...affected];
  }

  private emitChanged(slots: readonly number[]): void {
    this.emitter.emit("changed", { slots: [...new Set(slots)].sort((a, b) => a - b) });
  }
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (got ${value})`);
  }
}
