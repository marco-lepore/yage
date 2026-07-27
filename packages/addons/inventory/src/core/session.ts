/**
 * InventorySession — the headless UI orchestrator between one (swappable)
 * {@link InventorySource} and the presentation channels. It owns everything about
 * *browsing* — the cursor, the open/closed state, the action-menu sub-state —
 * and nothing about *pixels*: channels are interfaces, so the same session
 * drives the default renderer views, a DOM panel, or a test double.
 *
 * Input never reaches it directly: bindings (or a host menu system) call the
 * input-agnostic API (`move` / `confirm` / `cancel` / `sort` / `toggle`), which
 * is also how an embedded integration drives it from its own focus logic.
 *
 * Navigation *geometry* deliberately lives in the slots channel
 * ({@link SlotsChannel.navigate}): only the view knows whether "down" means
 * +1 (a list) or +columns (a grid), or how scrolling windows the cells.
 */

import { byCatalogOrder, type StackComparator } from "./comparators.js";
import type { InventorySource } from "./InventorySource.js";
import type {
  InstanceDataMap,
  ItemActionDef,
  ItemDef,
  ItemStack,
  LooseDataMap,
} from "./types.js";

/** Cursor directions the session routes — device-agnostic (dpad, keys, …). */
export type NavDirection = "up" | "down" | "left" | "right";

/** What a slots/detail channel renders for one slot: the stack (or null for
 *  an empty cell) plus its resolved def, so views never touch the catalog. */
export interface SlotView<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  readonly slot: number;
  readonly stack: ItemStack<TId, TData> | null;
  readonly def: ItemDef<TId> | null;
}

/**
 * The slot surface (grid, list, …). `present` always receives the FULL slot
 * array — views window/scroll it themselves. Channels must tolerate
 * `setVisible` before the first `present` (the session hides everything at
 * construction; a closed inventory shows nothing).
 */
export interface SlotsChannel<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  present(slots: readonly SlotView<TId, TData>[]): void;
  setSelected(slot: number): void;
  /** The slot the cursor lands on moving `dir` from `from` — the view owns
   *  its geometry (grid columns, list rows, wrapping). Return `from` for "no
   *  move" (an edge without wrap). */
  navigate(from: number, dir: NavDirection): number;
  setVisible(visible: boolean): void;
  clear(): void;
  update?(dt: number): void;
  /** Presenter-owned commit path (a DOM/clickable view calls it with the slot
   *  the user activated). The session assigns it — don't overwrite. */
  onSlotChosen?: (slot: number) => void;
}

/** The selected-item pane (name, description, quantity). `null` = empty slot. */
export interface DetailChannel<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  present(view: SlotView<TId, TData> | null): void;
  setVisible(visible: boolean): void;
  clear(): void;
  update?(dt: number): void;
}

/** One row of the action menu, resolved and ready to label. */
export interface PresentedAction {
  readonly id: string;
  readonly label: string;
}

/** The per-item action popup ("Use / Drop / Examine"). */
export interface ActionMenuChannel {
  /** Show the menu for the stack at `slot`. Always ≥ 1 action — the session
   *  never presents an empty menu. */
  present(actions: readonly PresentedAction[], slot: number): void;
  highlight(position: number): void;
  setVisible(visible: boolean): void;
  clear(): void;
  update?(dt: number): void;
  /** Presenter-owned commit path (a row the user activated). The session
   *  assigns it — don't overwrite. */
  onActionChosen?: (position: number) => void;
}

/** Header info the chrome renders alongside the panel frame. */
export interface InventoryChromeInfo {
  readonly title: string | undefined;
  /** Occupied slots. */
  readonly used: number;
  /** Total slots, or `undefined` for an unbounded inventory (hide the counter). */
  readonly capacity: number | undefined;
}

/** The panel frame + header. */
export interface InventoryChromeChannel {
  present(info: InventoryChromeInfo): void;
  setVisible(visible: boolean): void;
  update?(dt: number): void;
}

/** The channel set a session drives. Only `slots` is required — an embedded
 *  integration renders slots inside its own menu chrome and skips the rest. */
export interface InventoryChannels<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  readonly slots: SlotsChannel<TId, TData>;
  readonly chrome?: InventoryChromeChannel | undefined;
  readonly detail?: DetailChannel<TId, TData> | undefined;
  readonly actionMenu?: ActionMenuChannel | undefined;
}

/**
 * The input-agnostic driving surface a device binding (or a host menu) needs.
 * Deliberately free of the item-id generic so one binding implementation
 * drives any `InventorySession<TId>`; the session implements it.
 */
export interface InventorySessionDriver {
  isOpen(): boolean;
  isMenuOpen(): boolean;
  toggle(): void;
  move(dir: NavDirection): void;
  select(slot: number): void;
  confirm(): void;
  confirmSlot(slot: number): void;
  highlightMenu(position: number): void;
  confirmAction(position: number): void;
  cancel(): void;
  sort(): void;
}

export interface InventorySessionOptions<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> {
  /** Header title the chrome shows. */
  readonly title?: string | undefined;
  /**
   * What `cancel` does at browse level (the action menu always closes first).
   * `true` (default): close the inventory — the standalone behavior. Set
   * `false` when a host menu owns the escape route (embedded mode) and read
   * {@link onCancel} instead.
   */
  readonly closeOnCancel?: boolean | undefined;
  /** Comparator for {@link InventorySession.sort}. Default {@link byCatalogOrder}. */
  readonly sortComparator?: StackComparator<TId, TData> | undefined;
  readonly onOpened?: (() => void) | undefined;
  readonly onClosed?: (() => void) | undefined;
  /** The cursor moved to another slot (keyboard nav or pointer hover). */
  readonly onSelectionChanged?:
    | ((e: { readonly slot: number; readonly itemId: TId | null }) => void)
    | undefined;
  /**
   * Browse-level confirm on the selected slot, fired BEFORE any action menu
   * opens — the seam for picker flows ("choose an item to give"): configure no
   * actions and this is the whole interaction.
   */
  readonly onConfirm?:
    | ((e: { readonly slot: number; readonly itemId: TId | null }) => void)
    | undefined;
  /** Browse-level cancel, fired whether or not `closeOnCancel` also closes —
   *  an embedded host returns to its own menu here. */
  readonly onCancel?: (() => void) | undefined;
}

export class InventorySession<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> implements InventorySessionDriver {
  private source: InventorySource<TId, TData>;
  private readonly channels: InventoryChannels<TId, TData>;
  private readonly opts: InventorySessionOptions<TId, TData>;
  private title: string | undefined;

  private opened = false;
  private hidden = false;
  private paused = false;
  private selected = 0;
  private menuActions: readonly ItemActionDef<TId, TData>[] = [];
  private menuIndex = 0;
  private unsubscribe: (() => void) | undefined;

  constructor(
    source: InventorySource<TId, TData>,
    channels: InventoryChannels<TId, TData>,
    opts: InventorySessionOptions<TId, TData> = {},
  ) {
    this.source = source;
    this.channels = channels;
    this.opts = opts;
    this.title = opts.title;
    // Presenter-owned commit paths (pointer/DOM views activate rows directly).
    channels.slots.onSlotChosen = (slot) => this.confirmSlot(slot);
    if (channels.actionMenu) {
      channels.actionMenu.onActionChosen = (position) =>
        this.confirmAction(position);
    }
    this.applyVisibility();
    this.subscribe();
  }

  // ------------------------------------------------------------- lifecycle

  /** Show the panel and present the current model state. Idempotent. */
  open(): void {
    if (this.paused) return;
    if (this.opened) return;
    this.opened = true;
    this.selected = this.clampSlot(this.selected);
    this.refresh();
    // The menu never survives a close; make sure it starts closed too.
    this.closeMenu();
    this.applyVisibility();
    this.opts.onOpened?.();
  }

  /** Hide the panel (views keep their content for the next open). Idempotent. */
  close(): void {
    if (this.paused) return;
    if (!this.opened) return;
    this.closeMenu();
    this.opened = false;
    this.applyVisibility();
    this.opts.onClosed?.();
  }

  toggle(): void {
    if (this.paused) return;
    if (this.opened) this.close();
    else this.open();
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** True while the per-item action menu is up. */
  isMenuOpen(): boolean {
    return this.menuActions.length > 0;
  }

  /** Hide or show every channel without changing the open state. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyVisibility();
  }

  /** True while every channel is hidden by {@link setHidden}. */
  isHidden(): boolean {
    return this.hidden;
  }

  /**
   * Pause input, animation, and source-driven presentation updates while
   * preserving the open state, cursor, and menu.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      return;
    }
    this.subscribe();
    this.onModelChanged();
  }

  /** True while input, animation, and source-driven updates are paused. */
  isPaused(): boolean {
    return this.paused;
  }

  /** The cursor's slot index. */
  selection(): number {
    return this.selected;
  }

  /**
   * Swap the presented source (tabbed menus: Items ↔ Key Items reuse one
   * panel; a category tab swaps in a {@link filteredView} of the same model).
   * Resets the cursor, re-subscribes source events, and re-presents when
   * open. Pass `title` to relabel the chrome in the same step.
   */
  setSource(
    source: InventorySource<TId, TData>,
    opts: { readonly title?: string } = {},
  ): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.source = source;
    if (opts.title !== undefined) this.title = opts.title;
    this.selected = 0;
    this.subscribe();
    if (this.opened && !this.paused) {
      this.closeMenu();
      this.refresh();
    }
  }

  setTitle(title: string | undefined): void {
    this.title = title;
    if (this.opened && !this.paused) this.presentChrome();
  }

  /** The source currently presented — the escape hatch to everything else. */
  getSource(): InventorySource<TId, TData> {
    return this.source;
  }

  /** Forward the frame tick to channels that animate. */
  update(dt: number): void {
    if (this.paused) return;
    this.channels.slots.update?.(dt);
    this.channels.chrome?.update?.(dt);
    this.channels.detail?.update?.(dt);
    this.channels.actionMenu?.update?.(dt);
  }

  // ------------------------------------------------- input-agnostic driving

  /** Move the cursor (browse) or the menu highlight (menu open, up/down). */
  move(dir: NavDirection): void {
    if (this.paused || !this.opened) return;
    if (this.isMenuOpen()) {
      if (dir === "left" || dir === "right") return;
      const delta = dir === "up" ? -1 : 1;
      const n = this.menuActions.length;
      this.highlightMenu((this.menuIndex + delta + n) % n);
      return;
    }
    this.select(this.channels.slots.navigate(this.selected, dir));
  }

  /** Move the cursor to `slot` (clamped). No-op while the menu is open — a
   *  hover shouldn't yank the selection out from under an open menu. */
  select(slot: number): void {
    if (this.paused || !this.opened || this.isMenuOpen()) return;
    const next = this.clampSlot(slot);
    if (next === this.selected) return;
    this.selected = next;
    this.channels.slots.setSelected(next);
    this.presentDetail();
    this.opts.onSelectionChanged?.({
      slot: next,
      itemId: this.stackAt(next)?.itemId ?? null,
    });
  }

  /** Browse: fire `onConfirm`, then open the action menu when the selected
   *  stack offers actions. Menu: invoke the highlighted action. */
  confirm(): void {
    if (this.paused || !this.opened) return;
    if (this.isMenuOpen()) {
      this.invokeMenu(this.menuIndex);
      return;
    }
    this.opts.onConfirm?.({
      slot: this.selected,
      itemId: this.stackAt(this.selected)?.itemId ?? null,
    });
    this.openMenu();
  }

  /** Pointer path: put the cursor on `slot` and confirm it in one step.
   *  No-op while the action menu is open — close it first (`cancel()`); the
   *  default pointer binding does exactly that when a click lands off the
   *  menu, so pointer and programmatic driving stay consistent. */
  confirmSlot(slot: number): void {
    if (this.paused || !this.opened || this.isMenuOpen()) return;
    this.select(slot);
    this.confirm();
  }

  /** Pointer path: move the menu highlight (hover). */
  highlightMenu(position: number): void {
    if (this.paused || !this.isMenuOpen()) return;
    this.menuIndex = Math.max(
      0,
      Math.min(position, this.menuActions.length - 1),
    );
    this.channels.actionMenu?.highlight(this.menuIndex);
  }

  /** Pointer path: commit the menu row at `position`. */
  confirmAction(position: number): void {
    if (this.paused || !this.isMenuOpen()) return;
    this.invokeMenu(position);
  }

  /** Menu open: close it. Browse: fire `onCancel`, then close the inventory
   *  when `closeOnCancel` (the default). */
  cancel(): void {
    if (this.paused || !this.opened) return;
    if (this.isMenuOpen()) {
      this.closeMenu();
      return;
    }
    this.opts.onCancel?.();
    if (this.opts.closeOnCancel ?? true) this.close();
  }

  /** Sort the presented inventory with the configured comparator. Works
   *  whether or not the panel is open — the model is always live, and a
   *  closed panel picks the new order up on the next open. (Device bindings
   *  only reach this while open; the gate is theirs, not the model's.) */
  sort(): void {
    if (this.paused) return;
    this.source.sort(this.opts.sortComparator ?? byCatalogOrder);
  }

  // ------------------------------------------------------------- internals

  private subscribe(): void {
    if (this.paused || this.unsubscribe) return;
    this.unsubscribe = this.source.on("changed", () => this.onModelChanged());
  }

  /** Release the model subscription — the host calls this on teardown. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private onModelChanged(): void {
    if (!this.opened) return; // open() re-presents from scratch
    this.selected = this.clampSlot(this.selected);
    this.refresh();
    if (!this.isMenuOpen()) return;
    // The stack under the menu may have changed (consumed, moved, shrunk):
    // re-resolve; an emptied action set closes the menu.
    const actions = this.source.getActions(this.selected);
    if (actions.length === 0) {
      this.closeMenu();
      return;
    }
    this.menuActions = actions;
    this.menuIndex = Math.min(this.menuIndex, actions.length - 1);
    this.presentMenu();
  }

  private openMenu(): void {
    const actions = this.source.getActions(this.selected);
    if (actions.length === 0 || !this.channels.actionMenu) return;
    this.menuActions = actions;
    this.menuIndex = 0;
    this.presentMenu();
  }

  private invokeMenu(position: number): void {
    const action = this.menuActions[position];
    if (!action) return;
    const slot = this.selected;
    this.closeMenu();
    this.source.invokeAction(action.id, slot);
    if (action.closes) this.close();
  }

  private closeMenu(): void {
    if (this.menuActions.length === 0) return;
    this.menuActions = [];
    this.menuIndex = 0;
    this.channels.actionMenu?.clear();
    this.channels.actionMenu?.setVisible(false);
  }

  private presentMenu(): void {
    const menu = this.channels.actionMenu;
    if (!menu) return;
    menu.present(
      this.menuActions.map((a) => ({ id: a.id, label: a.label })),
      this.selected,
    );
    menu.setVisible(this.opened && !this.hidden);
    menu.highlight(this.menuIndex);
  }

  private refresh(): void {
    this.channels.slots.present(this.slotViews());
    this.channels.slots.setSelected(this.selected);
    this.presentDetail();
    this.presentChrome();
  }

  private presentDetail(): void {
    this.channels.detail?.present(this.viewOf(this.selected));
  }

  private presentChrome(): void {
    this.channels.chrome?.present({
      title: this.title,
      used: this.source.used,
      capacity: this.source.capacity,
    });
  }

  private slotViews(): SlotView<TId, TData>[] {
    const total = this.source.capacity ?? this.source.slots.length;
    const views: SlotView<TId, TData>[] = [];
    for (let i = 0; i < total; i++) views.push(this.viewOf(i));
    return views;
  }

  private viewOf(slot: number): SlotView<TId, TData> {
    const stack = this.stackAt(slot);
    return {
      slot,
      stack,
      def: stack ? this.source.catalog.get(stack.itemId) : null,
    };
  }

  private stackAt(slot: number): ItemStack<TId, TData> | null {
    return this.source.slots[slot] ?? null;
  }

  private clampSlot(slot: number): number {
    const max = (this.source.capacity ?? this.source.slots.length) - 1;
    return Math.max(0, Math.min(slot, Math.max(0, max)));
  }

  private applyVisibility(): void {
    const visible = this.opened && !this.hidden;
    this.channels.slots.setVisible(visible);
    this.channels.chrome?.setVisible(visible);
    this.channels.detail?.setVisible(visible);
    this.channels.actionMenu?.setVisible(visible && this.isMenuOpen());
  }
}
