/**
 * Core inventory model types. Everything here is engine-agnostic plain data —
 * JSON-able where it represents state ({@link ItemStack}, {@link InventorySnapshot})
 * so save round-trips need no mapping layer.
 *
 * The item *catalog* (what a "potion" is) and the inventory *state* (three
 * potions in slot 4) are deliberately separate: defs are code, state is data.
 * Stacks reference defs by id, so snapshots stay tiny and defs can change
 * between sessions without invalidating saves.
 */

/** How multiple units of one item distribute across slots.
 *  - `"multi"` (default): a full stack overflows into a new slot — Minecraft-style.
 *  - `"single"`: at most ONE stack of the item exists; `maxStack` is the total
 *    cap and anything beyond it is rejected — Zelda-arrows-style. */
export type StackingMode = "multi" | "single";

/** An item definition as authored in {@link defineItems} — the `id` is derived
 *  from the map key, mirroring how dialogue speakers are declared. */
export interface ItemDefInput {
  /** Display name (presenters render it; also the default sort text). */
  readonly name: string;
  /** Longer text for detail panes / examine actions. */
  readonly description?: string;
  /**
   * Icon texture key (a renderer `TextureInput` string). A presenter hint —
   * the headless model never resolves it. Omit it and the default presenters
   * draw a colored tile with the name's initial instead (zero-asset path).
   */
  readonly icon?: string;
  /** Tile tint for the icon-less fallback (presenter hint, 0xRRGGBB). Omitted:
   *  presenters pick a stable color from the theme palette by item id. */
  readonly color?: number;
  /** Free-form grouping (e.g. `"consumable"`, `"key"`) — used by sort
   *  comparators, section filters (`accepts`), and action availability. */
  readonly category?: string;
  readonly tags?: readonly string[];
  /** Units per stack (integer ≥ 1). Omitted: the inventory's `defaultMaxStack`
   *  (1 — unstackable unless declared). Under `"single"` stacking this is the
   *  item's TOTAL cap in the inventory. */
  readonly maxStack?: number;
  /** Stack distribution for this item. Default `"multi"`. */
  readonly stacking?: StackingMode;
  /** Ids of the inventory-level {@link ItemActionDef}s that apply to this item.
   *  Omitted: every inventory action applies (subject to its `available`). */
  readonly actions?: readonly string[];
  /** Game-owned payload (stats, effects, …). The model carries it opaquely. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A loaded item definition: the authored fields plus the id derived from the
 *  {@link defineItems} map key. Frozen at load. */
export interface ItemDef<TId extends string = string> extends ItemDefInput {
  readonly id: TId;
}

/**
 * One occupied slot: an item reference and a quantity. Immutable — the model
 * replaces stack objects on change, so a captured reference never mutates
 * under an observer and snapshots are structural copies.
 *
 * `data` is per-stack instance state (rolled stats, durability). A stack
 * carrying `data` NEVER auto-merges with another stack — merge would have to
 * invent a policy for reconciling two payloads.
 */
export interface ItemStack<TId extends string = string> {
  readonly itemId: TId;
  /** Units in this stack (integer ≥ 1 — a zero-quantity stack becomes `null`). */
  readonly quantity: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Why a mutation was (partly) refused. The `add`/`transfer` family emits the
 *  first four; `move`/`split`/`invokeAction` emit the last six. `"capacity"` is
 *  the one overlap — `split` also returns it when an auto target finds no empty
 *  slot. See each method's JSDoc for the subset it actually returns.
 *  - `"filtered"` — the inventory's `accepts` predicate refused the item.
 *  - `"capacity"` — no free slot for a new stack.
 *  - `"stack-cap"` — `"single"`-stacking item already at its total cap.
 *  - `"constraint"` — an {@link InventoryConstraint} clipped the quantity.
 *  - `"empty"` — the source slot holds nothing.
 *  - `"same-slot"` — source and target are the same slot.
 *  - `"out-of-range"` — the target slot is outside `capacity`.
 *  - `"occupied"` — the target slot already holds a stack.
 *  - `"indivisible"` — `split` was asked to take the whole stack or more.
 *  - `"no-action"` — the action id isn't currently offered for that slot. */
export type RejectReason =
  | "filtered"
  | "capacity"
  | "stack-cap"
  | "constraint"
  | "empty"
  | "same-slot"
  | "out-of-range"
  | "occupied"
  | "indivisible"
  | "no-action";

/** Outcome of a pass/fail gesture (`move`/`split`/`invokeAction`): always
 *  truthy, so a caller must read `.ok` rather than treating the return value
 *  itself as a boolean. `reason` is set on failure; `Extra` carries fields a
 *  success needs (e.g. `move`'s `effect`). */
export type Outcome<Extra = unknown> = {
  readonly ok: boolean;
  readonly reason?: RejectReason;
} & Extra;

/** Result of {@link Inventory.add}: partial adds are normal (a nearly-full
 *  inventory takes what fits). `reason` is set when `rejected > 0` and names
 *  the FIRST limit that clipped the request. */
export interface AddResult {
  readonly added: number;
  readonly rejected: number;
  readonly reason?: RejectReason;
  /** When `reason` is `"constraint"`: the `id` of the most limiting
   *  {@link InventoryConstraint} (absent if that constraint declared none). */
  readonly constraintId?: string;
  /** Indices of every slot the add touched (merged into or newly filled). */
  readonly slots: readonly number[];
}

/** Result of {@link Inventory.remove} / {@link Inventory.removeAt}: `removed`
 *  may be less than requested when the inventory held fewer units. `stacks` are
 *  the portions taken (in drain order), each carrying its `data` — so an
 *  instance payload can be re-homed (dropped, banked, undone) instead of lost.
 *  Empty when `removed` is 0. */
export interface RemoveResult<TId extends string = string> {
  readonly removed: number;
  readonly stacks: ReadonlyArray<ItemStack<TId>>;
}

/** What a successful {@link Inventory.move} did: `"moved"` fills an empty
 *  target, `"merged"` folds `from` into a same-item stack at `to` (leftover
 *  stays at `from`), `"swapped"` exchanges two stacks. */
export type MoveEffect = "moved" | "merged" | "swapped";

/** Result of {@link Inventory.split} / {@link Inventory.invokeAction}: a
 *  pass/fail gesture with a reason on failure (see {@link Outcome}). */
export type SplitResult = Outcome;
export type ActionResult = Outcome;

/** Result of {@link Inventory.move}: `effect` is present iff `ok`. */
export type MoveResult = Outcome<{ readonly effect?: MoveEffect }>;

/** Result of {@link Inventory.transfer} / {@link Inventory.transferSlot}. */
export interface TransferResult {
  readonly transferred: number;
  readonly rejected: number;
  /** The target's reject reason, when `rejected > 0`. */
  readonly reason?: RejectReason;
}

/** A stack paired with the slot it occupies — returned by {@link Inventory.find}
 *  / {@link Inventory.findAll} and accepted by {@link Inventory.remove} /
 *  {@link Inventory.transfer}. A positional snapshot: valid until the next
 *  mutation, exactly like a slot index (the model resolves it by identity, so a
 *  stale ref is a safe no-op rather than a wrong removal). */
export interface LocatedStack<TId extends string = string> {
  readonly slot: number;
  readonly stack: ItemStack<TId>;
}

/** Selects stacks by their per-instance `data`. Stacks with NO `data` are
 *  excluded before it runs, so `data` is always defined here — a data predicate
 *  is a question about instances (durability, rolled stats). `stack` is the full
 *  stack for the rare quantity check. */
export type StackPredicate<TId extends string = string> = (
  data: Readonly<Record<string, unknown>>,
  stack: ItemStack<TId>,
) => boolean;

/**
 * Read-only view of an inventory — what policy hooks ({@link InventoryConstraint},
 * {@link ItemActionDef.available}) receive, so a policy can inspect state but
 * not recurse into mutations mid-operation. `Inventory` implements it.
 */
export interface InventoryReader<TId extends string = string> {
  /** Slot array, `null` for empty slots. Bounded inventories always have
   *  `capacity` entries; unbounded ones grow as stacks land. */
  readonly slots: ReadonlyArray<ItemStack<TId> | null>;
  /** Max slot count, or `undefined` for an unbounded inventory. */
  readonly capacity: number | undefined;
  /** Occupied slot count. */
  readonly used: number;
  /** Total units of `itemId`. Without a predicate every stack counts; with a
   *  {@link StackPredicate}, only data-bearing stacks whose `data` matches. */
  count(itemId: TId, where?: StackPredicate<TId>): number;
  /** Whether at least `quantity` (default 1) matching units of `itemId` are
   *  held. A {@link StackPredicate} (in place of, or after, `quantity`) restricts
   *  the tally to matching data stacks. */
  has(itemId: TId, quantityOrWhere?: number | StackPredicate<TId>, where?: StackPredicate<TId>): boolean;
  /** First stack of `itemId` matching the optional predicate, with its slot. */
  find(itemId: TId, where?: StackPredicate<TId>): LocatedStack<TId> | undefined;
  /** Every stack of `itemId` matching the optional predicate, in slot order. */
  findAll(itemId: TId, where?: StackPredicate<TId>): readonly LocatedStack<TId>[];
}

/**
 * A pluggable acceptance limit beyond slot capacity — the extension point for
 * weight limits, currency caps, quest gates. Slot capacity itself is
 * structural (the model enforces it while placing stacks); a constraint only
 * answers "how many MORE units of this item may enter right now".
 *
 * ```ts
 * const weightLimit = (max: number): InventoryConstraint => ({
 *   id: "weight",
 *   maxAcceptable: (def, inv) => {
 *     const weightOf = (d: ItemDef) => (d.data?.weight as number) ?? 0;
 *     const current = inv.slots.reduce((sum, s) =>
 *       s ? sum + weightOf(catalog.get(s.itemId)) * s.quantity : sum, 0);
 *     const per = weightOf(def);
 *     return per <= 0 ? Infinity : Math.floor((max - current) / per);
 *   },
 * });
 * ```
 */
export interface InventoryConstraint<TId extends string = string> {
  /** Diagnostic label (not used by the model logic). */
  readonly id?: string;
  /** Max additional units of `def` the inventory may accept (≥ 0; `Infinity`
   *  for "no limit from this constraint"). */
  maxAcceptable(def: ItemDef<TId>, inventory: InventoryReader<TId>): number;
}

/** Context handed to {@link ItemActionDef.available}. */
export interface ItemActionContext<TId extends string = string> {
  readonly slot: number;
  readonly stack: ItemStack<TId>;
  readonly def: ItemDef<TId>;
  readonly inventory: InventoryReader<TId>;
}

/**
 * An action a player can perform on a held item ("Use", "Drop", "Equip").
 * Actions are declared per-inventory; an item narrows the applicable set via
 * `ItemDef.actions` and `available` refines it per-stack at menu time.
 *
 * Invoking one emits the model's `"action"` event — the CONSEQUENCE (heal the
 * player, spawn a drop) is the game's, wired in an event handler. `consumes`
 * is the one built-in convenience: the model removes one unit after emitting,
 * covering the use-a-consumable case without a handler having to mutate.
 */
export interface ItemActionDef<TId extends string = string> {
  readonly id: string;
  /** Menu label. */
  readonly label: string;
  /** Per-stack availability (a gate on top of `ItemDef.actions`). Omitted:
   *  always available. */
  available?(ctx: ItemActionContext<TId>): boolean;
  /** Remove one unit from the stack after the action event. Don't ALSO remove
   *  it in your handler — that would consume two. */
  readonly consumes?: boolean;
  /** Hint for UI sessions: close the inventory after invoking (e.g. "Use" on
   *  a consumable in menus that return to gameplay). The model ignores it. */
  readonly closes?: boolean;
}

/** JSON round-trip of one stack — structurally an {@link ItemStack} with the
 *  id widened to `string` (a snapshot may reference items the current catalog
 *  no longer declares; {@link Inventory.restore} drops those). */
export interface ItemStackSnapshot {
  readonly itemId: string;
  readonly quantity: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Full JSON-able state of an inventory — feed it to a save system (e.g. a
 *  `@yagejs/save` `SnapshotContributor`) and back through {@link Inventory.restore}. */
export interface InventorySnapshot {
  readonly slots: ReadonlyArray<ItemStackSnapshot | null>;
}

/** Payload map of the model events {@link Inventory.on} exposes. */
export interface InventoryEvents<TId extends string = string> {
  /** Any mutation, with every affected slot index — the coarse "re-render"
   *  signal presenters subscribe to. Fires once per operation, after the
   *  fine-grained event for that operation. */
  changed: { readonly slots: readonly number[] };
  /** Units entered the inventory (`add`/`transfer`), after partial clipping. */
  itemAdded: {
    readonly itemId: TId;
    readonly quantity: number;
    readonly slots: readonly number[];
  };
  /** Units left the inventory (`remove`/`removeAt`/consumed actions/`transfer`). */
  itemRemoved: { readonly itemId: TId; readonly quantity: number };
  /** An `add` was (partly) refused — the "inventory full!" toast hook. */
  rejected: {
    readonly itemId: TId;
    readonly quantity: number;
    readonly reason: RejectReason;
    /** When `reason` is `"constraint"`: the most limiting constraint's `id`,
     *  so a weight-limit toast and a quest-gate toast can differ. */
    readonly constraintId?: string;
  };
  /** An item action was invoked — the game applies the consequence here. */
  action: {
    readonly actionId: string;
    readonly slot: number;
    readonly itemId: TId;
    /** Stack quantity at invocation time (before any `consumes` removal). */
    readonly quantity: number;
    /** True when the action declares `consumes` — the model removes one unit
     *  itself right after this event. Branch on it instead of removing in the
     *  handler, or you consume two. */
    readonly consumes: boolean;
  };
}
