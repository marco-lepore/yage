/**
 * InventoryController — the thin YAGE host. It owns no inventory logic; it just:
 *
 *   • mounts the presenters onto the scene,
 *   • builds a headless {@link InventorySession} over them,
 *   • mirrors the model's events and the session's callbacks onto engine events,
 *   • attaches an {@link InputBinding} (keyboard + pointer by default) and pumps it,
 *   • pumps `session.update(dt)` each frame.
 *
 * The presenter bundle usually comes from a factory (`createInventoryPanel(theme)`
 * on the `/presenters` entry), spread-and-overridden as needed:
 *
 *   host.add(new InventoryController({ ...createInventoryPanel(theme), inventory }));
 *
 * Standalone vs embedded is a configuration choice, not a different API:
 * the default is a self-sufficient panel (chrome + toggle key + Escape to
 * close); an embedded host passes `input: null` + `closeOnCancel: false`,
 * omits the chrome, and drives `open`/`close`/`move`/`confirm` from its own
 * menu focus.
 */

import {
  Component,
  LocalizationKey,
  LoggerKey,
  isDev,
  type LocalizableText,
  type Logger,
} from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { InventorySource } from "./core/InventorySource.js";
import { InventorySession, type NavDirection } from "./core/session.js";
import type { StackComparator } from "./core/comparators.js";
import type { InventoryKeys } from "./core/keys.js";
import type { InstanceDataMap, LooseDataMap } from "./core/types.js";
import type { InventoryBundle } from "./adapter.js";
import { inventoryControls, type InputBinding } from "./input/index.js";
import {
  InventoryActionEvent,
  InventoryChangedEvent,
  InventoryClosedEvent,
  InventoryItemAddedEvent,
  InventoryItemRemovedEvent,
  InventoryOpenedEvent,
  InventoryRejectedEvent,
  InventorySelectionChangedEvent,
} from "./events.js";

// Extends the DEFAULT (string-typed) bundle on purpose: presenters are
// id-agnostic views, and keeping `TId` out of the presenter fields lets the
// compiler infer `TId` from `inventory` alone — `new InventoryController({
// ...bundle, inventory })` stays fully typed with no explicit type argument.
export interface InventoryControllerOptions<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> extends InventoryBundle {
  /** The source to present — an {@link Inventory} (the identity source, "all
   *  items") or a {@link filteredView} of one. Swap it live with
   *  {@link InventoryController.setSource}. */
  readonly inventory: InventorySource<TId, TData>;
  /** Header title the chrome shows — a literal, or a `msg(...)` binding that
   *  re-resolves on locale change. */
  readonly title?: LocalizableText | undefined;
  /**
   * Catalog-key scheme for item names, descriptions, and action labels.
   * Default `defaultInventoryKeys` (`inventory.item.<id>.name`, …). Item and
   * action definitions keep their authored strings as the fallback, so a
   * catalog is additive — with no `LocalizationPlugin` registered nothing
   * changes.
   */
  readonly keys?: InventoryKeys | undefined;
  /**
   * What `cancel` does at browse level (the action menu always closes first).
   * `true` (default): close the inventory. Set `false` when a host menu owns
   * the escape route (embedded mode) and use {@link onCancel}.
   */
  readonly closeOnCancel?: boolean | undefined;
  /** Comparator behind the sort control. Default catalog authoring order. */
  readonly sortComparator?: StackComparator<TId, TData> | undefined;
  /**
   * Device → session binding. Three modes:
   * - omit: the zero-config default, {@link inventoryControls} wired to this
   *   controller's own presenters — keyboard/gamepad over the `move-up`/
   *   `move-down`/`move-left`/`move-right`/`interact`/`cancel`/`sort`/
   *   `inventory` action names PLUS mouse/touch with cell and menu-row
   *   hit-testing. Construct `inventoryControls(bundle, { actions })` yourself only
   *   to rename the actions.
   * - an {@link InputBinding}: your own device mapping.
   * - `null`: NO device input — the embedded mode, where the host menu calls
   *   {@link open}/{@link move}/{@link confirm}/{@link cancel} itself.
   * Unmapped action names silently never fire; a full mismatch logs a
   * dev-mode warning.
   */
  readonly input?: InputBinding | null | undefined;
  /** Open as soon as the component mounts (a debug/menu scene). Default false. */
  readonly openOnAdd?: boolean | undefined;
  /** Browse-level confirm on the selected slot (fires before any action menu
   *  opens) — the picker-flow seam. */
  readonly onConfirm?:
    | ((e: { readonly slot: number; readonly itemId: TId | null }) => void)
    | undefined;
  /** Browse-level cancel (fires whether or not `closeOnCancel` closes) — an
   *  embedded host returns to its own menu here. */
  readonly onCancel?: (() => void) | undefined;
}

export class InventoryController<
  TId extends string = string,
  TData extends InstanceDataMap<TId> = LooseDataMap<TId>,
> extends Component {
  private readonly inputManager = this.service(InputManagerKey);
  private readonly binding: InputBinding | undefined;
  /** Live between onAdd and onDestroy; cleared on destroy so post-teardown
   *  calls no-op instead of driving disposed presenters. */
  private session: InventorySession<TId, TData> | undefined;
  /** Captured at onAdd (the scene is gone by the time a stale open() arrives). */
  private logger: Logger | undefined;
  /** Set by onDestroy — the presenters are disposed, so open() must refuse. */
  private destroyed = false;
  /** Input focus. When false the binding is NOT polled, so this instance
   *  consumes no device input — the seam for two panels side by side (player
   *  chest transfer screens) or an embedded host that forwards input itself. */
  private inputEnabled = true;
  private bindingActive = false;
  private openOnEnable: boolean;
  private dismissMenuOnEnable = false;
  /** Disposers for the model→engine event mirror (rewired by setSource). */
  private readonly modelUnsubs: (() => void)[] = [];

  constructor(private readonly opts: InventoryControllerOptions<TId, TData>) {
    super();
    this.openOnEnable = opts.openOnAdd ?? false;
    // Zero-config: keyboard/gamepad + mouse/touch, with pointer hit-testing
    // wired to the presenters this controller already holds. `input: null` =
    // no device input at all (embedded mode).
    this.binding =
      opts.input === null
        ? undefined
        : (opts.input ??
          inventoryControls({
            slots: opts.slots,
            actionMenu: opts.actionMenu,
          }));
  }

  onAdd(): void {
    this.logger = this.context.tryResolve(LoggerKey);
    // One diagnostics seam shared by presenter-level warnings — they land on
    // the engine Logger, never console.warn.
    const warn = (message: string): void =>
      this.logger?.warn("inventory", message);

    // Wire diagnostics BEFORE mounting: a presenter may run a mount-time check
    // (the slot view warns when its window overflows the panel), which needs
    // the sink already in place or the warning silently no-ops.
    this.opts.slots.setDiagnostics?.(warn);
    this.opts.chrome?.setDiagnostics?.(warn);
    this.opts.detail?.setDiagnostics?.(warn);
    this.opts.actionMenu?.setDiagnostics?.(warn);

    this.opts.slots.mount(this.scene);
    this.opts.chrome?.mount(this.scene);
    this.opts.detail?.mount(this.scene);
    this.opts.actionMenu?.mount(this.scene);

    // Optional: `undefined` when the game registered no LocalizationPlugin, in
    // which case every string renders as authored.
    const localization = this.context.tryResolve(LocalizationKey);

    this.session = new InventorySession<TId, TData>(
      this.opts.inventory,
      {
        slots: this.opts.slots,
        chrome: this.opts.chrome,
        detail: this.opts.detail,
        actionMenu: this.opts.actionMenu,
      },
      {
        title: this.opts.title,
        localization,
        keys: this.opts.keys,
        closeOnCancel: this.opts.closeOnCancel,
        sortComparator: this.opts.sortComparator,
        onOpened: () => this.entity.emit(InventoryOpenedEvent),
        onClosed: () => this.entity.emit(InventoryClosedEvent),
        onSelectionChanged: (e) =>
          this.entity.emit(InventorySelectionChangedEvent, e),
        onConfirm: this.opts.onConfirm,
        onCancel: this.opts.onCancel,
      },
    );
    this.warnIfActionsUnmapped(warn);
    this.session.setPaused(true);
    this.session.setHidden(true);

    // Follow the engine locale: every revision bump (locale switch, lazy
    // catalog load) re-presents the panel in the new locale. Cleaned up with
    // the component, so a removed controller stops listening and a re-added
    // one doesn't subscribe twice.
    if (localization) {
      this.addCleanup(
        localization.subscribe(() => this.session?.relocalize()),
      );
    }
  }

  onEnable(): void {
    this.session?.setPaused(false);
    if (this.dismissMenuOnEnable && this.session?.isMenuOpen()) {
      this.session.cancel();
    }
    this.dismissMenuOnEnable = false;
    this.session?.setHidden(false);
    if (this.openOnEnable) {
      this.openOnEnable = false;
      this.session?.open();
    }
    this.mirrorModel(this.inventory);
    this.syncBinding();
  }

  onDisable(): void {
    this.deactivateBinding();
    this.clearModelMirror();
    this.session?.setPaused(true);
    this.session?.setHidden(true);
  }

  onDestroy(): void {
    this.destroyed = true;
    this.clearModelMirror();
    this.session?.dispose();
    // Clear it: the convenience methods (close/move/confirm/…) drive
    // `this.session?.x()`, so a stale reference calling them after removal must
    // no-op, not reach into torn-down presenters or re-sort the model.
    this.session = undefined;
    this.deactivateBinding();
    this.opts.slots.dispose();
    this.opts.chrome?.dispose();
    this.opts.detail?.dispose();
    this.opts.actionMenu?.dispose();
  }

  update(dt: number): void {
    this.session?.update(dt);
    // Polled only when focused, so a backgrounded panel consumes no device
    // input. The toggle key comes through the binding, so an unfocused
    // controller doesn't even open.
    if (this.bindingActive) this.binding?.poll();
  }

  // ------------------------------------------------------------- lifecycle

  /** Show the panel. Refuses after removal (warns); throws before `onAdd`. */
  open(): void {
    const session = this.guard("open");
    if (!session || !this.effectiveEnabled) return;
    session.open();
  }

  close(): void {
    if (this.effectiveEnabled) this.session?.close();
  }

  toggle(): void {
    const session = this.guard("toggle");
    if (!session || !this.effectiveEnabled) return;
    session.toggle();
  }

  isOpen(): boolean {
    return this.session?.isOpen() ?? false;
  }

  /** True while the per-item action menu is up. */
  isMenuOpen(): boolean {
    return this.session?.isMenuOpen() ?? false;
  }

  /**
   * Swap the presented source (tabbed menus: Items ↔ Key Items in one panel;
   * a category tab swaps in a {@link filteredView} of the same model).
   * Re-mirrors source events onto the entity and re-presents when open.
   */
  setSource(
    source: InventorySource<TId, TData>,
    opts: { readonly title?: LocalizableText } = {},
  ): void {
    const session = this.guard("setSource");
    if (!session) return;
    session.setSource(source, opts);
    if (this.effectiveEnabled) this.mirrorModel(source);
  }

  /** Relabel the chrome header — a literal, or a `msg(...)` binding. */
  setTitle(title: LocalizableText | undefined): void {
    this.session?.setTitle(title);
  }

  /** The source currently presented — the raw {@link Inventory} when passed
   *  directly, or a {@link filteredView}'s projection otherwise. Game logic
   *  reads and mutates the underlying model directly (it's live whether or
   *  not this panel is open); this is the escape hatch to whatever surface is
   *  currently on screen. */
  get inventory(): InventorySource<TId, TData> {
    return this.session ? this.session.getSource() : this.opts.inventory;
  }

  /**
   * Set whether this controller consumes device input — the focus seam for
   * multi-panel setups. `setInputEnabled(false)` keeps the panel visible and
   * live (model changes still re-present) but stops polling its binding, and
   * closes an open action menu (nothing could dismiss it on an unfocused
   * panel). Switch focus between two panels with `a.setInputEnabled(true);
   * b.setInputEnabled(false)`. (YAGE input is non-consuming, so two *enabled*
   * bindings both react to one press — focus is the game's policy.)
   */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    // cancel() with the menu open closes ONLY the menu — exactly the scoped
    // dismissal wanted when focus leaves.
    if (enabled) {
      this.dismissMenuOnEnable = false;
    } else if (this.session?.isMenuOpen()) {
      if (this.effectiveEnabled) this.session.cancel();
      else this.dismissMenuOnEnable = true;
    }
    this.syncBinding();
  }

  // ------------------------------------------- input-agnostic driving seam

  /** Move the cursor (or the menu highlight) — the same call the default
   *  {@link InputBinding} makes; lets a host menu or a test drive the panel
   *  without synthesising device input. */
  move(dir: NavDirection): void {
    if (this.effectiveEnabled) this.session?.move(dir);
  }

  /** Move the cursor to `slot` (clamped; inert while the menu is open). */
  select(slot: number): void {
    if (this.effectiveEnabled) this.session?.select(slot);
  }

  /** The cursor's slot index. */
  selection(): number {
    return this.session?.selection() ?? 0;
  }

  /** Confirm the selected slot (browse) or the highlighted action (menu). */
  confirm(): void {
    if (this.effectiveEnabled) this.session?.confirm();
  }

  /** Close the menu — or, at browse level, cancel out of the panel. */
  cancel(): void {
    if (this.effectiveEnabled) this.session?.cancel();
  }

  /** Sort the presented inventory with the configured comparator. */
  sort(): void {
    if (this.effectiveEnabled) this.session?.sort();
  }

  // ------------------------------------------------------------- internals

  /** Mirror the source's events onto the entity bus — the one canonical
   *  observation path (fires whether or not the panel is open). A
   *  {@link filteredView} forwards everything but `"changed"` straight from
   *  its underlying model, so these still carry real item ids/quantities. */
  private mirrorModel(source: InventorySource<TId, TData>): void {
    this.clearModelMirror();
    this.modelUnsubs.push(
      source.on("action", (e) => this.entity.emit(InventoryActionEvent, e)),
      source.on("itemAdded", (e) =>
        this.entity.emit(InventoryItemAddedEvent, e),
      ),
      source.on("itemRemoved", (e) =>
        this.entity.emit(InventoryItemRemovedEvent, e),
      ),
      source.on("rejected", (e) => this.entity.emit(InventoryRejectedEvent, e)),
      source.on("changed", (e) => this.entity.emit(InventoryChangedEvent, e)),
    );
  }

  private clearModelMirror(): void {
    for (const unsub of this.modelUnsubs) unsub();
    this.modelUnsubs.length = 0;
  }

  private syncBinding(): void {
    if (
      !this.binding ||
      !this.session ||
      !this.effectiveEnabled ||
      !this.inputEnabled
    ) {
      this.deactivateBinding();
      return;
    }
    if (this.bindingActive) return;
    this.binding.bind(this.inputManager, this.session);
    this.bindingActive = true;
  }

  private deactivateBinding(): void {
    if (!this.bindingActive) return;
    this.binding?.dispose?.();
    this.bindingActive = false;
  }

  /** Shared refuse/throw policy for state-changing calls: returns the live
   *  session, or `undefined` when the component has been removed (warns — stale
   *  references happen). Throws when called before `onAdd` (a wiring bug at the
   *  call site). */
  private guard(method: string): InventorySession<TId, TData> | undefined {
    if (this.destroyed) {
      this.logger?.warn(
        "inventory",
        `InventoryController.${method}() ignored: the component has been removed/destroyed.`,
      );
      return undefined;
    }
    if (!this.session) {
      throw new Error(
        `InventoryController.${method}() called before the component was added to an entity (onAdd has not run yet).`,
      );
    }
    return this.session;
  }

  /**
   * Warn (dev only) when NONE of the binding's polled action names exist in
   * the live `InputManager` map — the silent-no-op trap: the default names
   * (kebab-case `move-up`/`interact`/…) don't match a game's custom map, so
   * keyboard controls do nothing with no error anywhere. A partial mismatch
   * is intentional (a game may bind only a subset), so only a total miss warns.
   */
  private warnIfActionsUnmapped(warn: (message: string) => void): void {
    if (!isDev()) return;
    const names = this.binding?.actionNames?.() ?? [];
    if (names.length === 0) return; // pointer-only or no binding — nothing to validate
    const mapped = new Set(this.inputManager.getActionNames());
    if (names.some((a) => mapped.has(a))) return; // at least one is wired
    warn(
      `inventory input binding references action names absent from the InputManager map ` +
        `(${names.join(", ")}); keyboard/gamepad controls will do nothing. Pass an ` +
        `\`input\` binding wired to your game's action names.`,
    );
  }
}
