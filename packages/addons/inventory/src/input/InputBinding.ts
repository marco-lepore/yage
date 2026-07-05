/**
 * Input is externalised so it's obviously *optional* and obviously *swappable*.
 * An `InventorySession` exposes an input-agnostic API (`move / confirm /
 * cancel / sort / toggle`); an {@link InputBinding} is whatever maps a device
 * onto it. The default {@link KeyboardInputBinding} polls the YAGE
 * `InputManager` action map; {@link PointerInputBinding} adds hover + click
 * through the presenters' hit-test seams. An embedded integration usually
 * attaches NO binding (`input: null` on the controller) and drives the
 * session from its own menu focus instead.
 *
 * YAGE input is non-consuming by design, so a click handled here still fires
 * any gameplay action bound to the same button — claiming pointers
 * (`InputManager.consumePointer`) is the game's policy, not the binding's.
 */

import type { InputManager } from "@yagejs/input";
import type { InventorySessionDriver } from "../core/session.js";

export interface InventoryActions {
  readonly up: readonly string[];
  readonly down: readonly string[];
  readonly left: readonly string[];
  readonly right: readonly string[];
  /** Confirm the slot (opens the action menu) / commit the menu row. */
  readonly confirm: readonly string[];
  /** Close the menu, then the inventory (see the session's `closeOnCancel`). */
  readonly cancel: readonly string[];
  /** Sort the presented inventory. Unbound games just omit the mapping. */
  readonly sort?: readonly string[];
  /** Open/close the panel — the ONE action polled while closed. */
  readonly toggle?: readonly string[];
}

export const INVENTORY_ACTIONS: InventoryActions = {
  up: ["move-up"],
  down: ["move-down"],
  left: ["move-left"],
  right: ["move-right"],
  confirm: ["interact"],
  cancel: ["cancel"],
  sort: ["sort"],
  toggle: ["inventory"],
};

export interface InputBinding {
  /**
   * Wire a device to a session. Called by the host once both exist. A binding
   * has a single owner: re-binding re-targets it (implementations must release
   * any resources held for the previous bind) — don't share one instance
   * between two live controllers.
   */
  bind(input: InputManager, session: InventorySessionDriver): void;
  /** Poll the device and drive the session. Called once per frame by the host. */
  poll(): void;
  /** Optional teardown (e.g. unsubscribe pointer listeners). */
  dispose?(): void;
  /**
   * The `InputManager` action names this binding polls, if it polls any. The
   * host reads these to validate them against the live action map — a binding
   * whose names are all absent silently no-ops. Device bindings that poll no
   * action map (e.g. a pure pointer binding) omit this.
   */
  actionNames?(): readonly string[];
}

/**
 * A presenter that can resolve a pointer point to a slot index — lets a
 * pointer binding hover/click cells without owning their geometry. Coords are
 * in `pointerSpace` ("screen" default; a world-anchored surface uses "world").
 */
export interface PointerSlotTarget {
  slotAtPoint?(x: number, y: number): number | undefined;
  readonly pointerSpace?: "screen" | "world" | undefined;
}

/** A presenter that can resolve a pointer point to an action-menu row. */
export interface PointerActionTarget {
  actionAtPoint?(x: number, y: number): number | undefined;
}

/** The hit-test seams a pointer binding reads. An `InventoryBundle` satisfies
 *  this shape directly: `inventoryControls(bundle)`. */
export interface PointerTargets {
  readonly slots?: PointerSlotTarget | undefined;
  readonly actionMenu?: PointerActionTarget | undefined;
}

/** Fan a single session out to several device bindings (keyboard + pointer …). */
export class CompositeInputBinding implements InputBinding {
  constructor(private readonly bindings: readonly InputBinding[]) {}
  bind(input: InputManager, session: InventorySessionDriver): void {
    for (const b of this.bindings) b.bind(input, session);
  }
  poll(): void {
    for (const b of this.bindings) b.poll();
  }
  dispose(): void {
    for (const b of this.bindings) b.dispose?.();
  }
  /** Union of every child binding's polled action names (de-duplicated). */
  actionNames(): readonly string[] {
    const names = new Set<string>();
    for (const b of this.bindings) {
      for (const a of b.actionNames?.() ?? []) names.add(a);
    }
    return [...names];
  }
}

/** Keyboard/gamepad action-map binding (the default). */
export class KeyboardInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: InventorySessionDriver;

  constructor(private readonly actions: InventoryActions = INVENTORY_ACTIONS) {}

  bind(input: InputManager, session: InventorySessionDriver): void {
    this.input = input;
    this.session = session;
  }

  /** Every action name this binding polls, across all slots (de-duplicated). */
  actionNames(): readonly string[] {
    const { up, down, left, right, confirm, cancel, sort, toggle } = this.actions;
    return [
      ...new Set([
        ...up,
        ...down,
        ...left,
        ...right,
        ...confirm,
        ...cancel,
        ...(sort ?? []),
        ...(toggle ?? []),
      ]),
    ];
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;
    // Toggle is the one control that works while closed.
    if (this.actions.toggle && justPressed(input, this.actions.toggle)) session.toggle();
    if (!session.isOpen()) return;
    if (justPressed(input, this.actions.up)) session.move("up");
    else if (justPressed(input, this.actions.down)) session.move("down");
    if (justPressed(input, this.actions.left)) session.move("left");
    else if (justPressed(input, this.actions.right)) session.move("right");
    if (justPressed(input, this.actions.confirm)) session.confirm();
    if (justPressed(input, this.actions.cancel)) session.cancel();
    if (this.actions.sort && justPressed(input, this.actions.sort)) session.sort();
  }
}

function justPressed(input: InputManager, actions: readonly string[]): boolean {
  return actions.some((a) => input.isJustPressed(a));
}

/**
 * Mouse/touch binding. Hovering a cell moves the cursor; clicking one opens
 * its action menu; hovering/clicking menu rows highlights/commits them; a
 * click OFF an open menu closes it (the familiar context-menu dismiss).
 * Works for both mouse and touch since it rides the unified pointer stream.
 */
export class PointerInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: InventorySessionDriver;
  // Explicit `| undefined` so `dispose()` can null it (exactOptionalPropertyTypes).
  private unsub: (() => void) | undefined;
  /** A primary-button press happened since the last poll (consumed in poll). */
  private clicked = false;

  // Explicit `| undefined` (not `?:`) so the ctor can assign the possibly-
  // undefined argument under `exactOptionalPropertyTypes`.
  private readonly targets: PointerTargets | undefined;

  /** Pointer position at the last hover hit-test, so an unmoved pointer
   *  doesn't re-run the hit-test every frame. */
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  /** Whether the previous poll saw the menu up (a fresh menu must be
   *  hit-tested even under a stationary pointer). */
  private wasMenuOpen = false;

  constructor(targets?: PointerTargets) {
    this.targets = targets;
  }

  bind(input: InputManager, session: InventorySessionDriver): void {
    // Self-heal a re-bind: release the previous pointer subscription, which
    // would otherwise leak past dispose() and keep driving the old session.
    this.unsub?.();
    this.input = input;
    this.session = session;
    this.unsub = input.onPointerDown((info) => {
      if (info.button === 0) this.clicked = true; // primary button / touch only
    });
  }

  /** Pointer position in the slots presenter's coordinate space. */
  private pointer(input: InputManager): { x: number; y: number } {
    return this.targets?.slots?.pointerSpace === "world"
      ? input.getPointerPosition()
      : input.getPointerScreenPosition();
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;
    if (!session.isOpen()) {
      this.clicked = false;
      this.wasMenuOpen = false;
      return;
    }

    const menuOpen = session.isMenuOpen();
    const p = this.pointer(input);
    const moved = p.x !== this.lastX || p.y !== this.lastY;

    // Hover: menu rows take precedence over cells while the menu is up.
    if (moved || menuOpen !== this.wasMenuOpen) {
      this.lastX = p.x;
      this.lastY = p.y;
      if (menuOpen) {
        const row = this.targets?.actionMenu?.actionAtPoint?.(p.x, p.y);
        if (row !== undefined) session.highlightMenu(row);
      } else {
        const slot = this.targets?.slots?.slotAtPoint?.(p.x, p.y);
        if (slot !== undefined) session.select(slot);
      }
    }
    this.wasMenuOpen = menuOpen;

    const clicked = this.clicked;
    this.clicked = false;
    if (!clicked) return;
    if (menuOpen) {
      const row = this.targets?.actionMenu?.actionAtPoint?.(p.x, p.y);
      if (row !== undefined) session.confirmAction(row);
      else session.cancel(); // click off the menu dismisses it
    } else {
      const slot = this.targets?.slots?.slotAtPoint?.(p.x, p.y);
      if (slot !== undefined) session.confirmSlot(slot);
      // A click off the panel does nothing (keyboard nav still available).
    }
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = undefined;
  }
}

/**
 * The full control set in one binding: keyboard/gamepad (cursor / confirm /
 * cancel / sort / toggle) **and** mouse/touch (hover + click cells and menu
 * rows). This is the controller's default — it wires it to its own
 * presenters when `input` is omitted — so construct it yourself only to
 * customize, e.g. rename the actions:
 *
 * ```ts
 * const bundle = createGridInventory(theme);
 * new InventoryController({
 *   ...bundle,
 *   inventory,
 *   input: inventoryControls(bundle, { actions: { ...INVENTORY_ACTIONS, toggle: ["bag"] } }),
 * });
 * ```
 */
export function inventoryControls(
  targets?: PointerTargets,
  options: { actions?: InventoryActions } = {},
): InputBinding {
  const { actions = INVENTORY_ACTIONS } = options;
  return new CompositeInputBinding([
    new KeyboardInputBinding(actions),
    new PointerInputBinding(targets),
  ]);
}
