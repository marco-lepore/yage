import type { ActionMapDefinition, InputManager } from "@yagejs/input";
import type {
  HotbarDriver,
  HotbarInputBinding,
  HotbarPresenter,
} from "./adapter.js";

export interface HotbarActions {
  readonly slots: readonly string[];
  readonly previous: string;
  readonly next: string;
  readonly activate: string;
  readonly clear: string;
}

export const DEFAULT_HOTBAR_ACTIONS: HotbarActions = {
  slots: Array.from({ length: 10 }, (_, i) => `hotbar-${i + 1}`),
  previous: "hotbar-previous",
  next: "hotbar-next",
  activate: "hotbar-activate",
  clear: "hotbar-clear",
};

/** Merge into InputPlugin's actions. Override or rebind through the input package. */
export const HOTBAR_ACTION_MAP: ActionMapDefinition = {
  ...Object.fromEntries(
    DEFAULT_HOTBAR_ACTIONS.slots.map((name, i) => [
      name,
      [`Digit${(i + 1) % 10}`],
    ]),
  ),
  [DEFAULT_HOTBAR_ACTIONS.previous]: ["ArrowLeft", "GamepadLB"],
  [DEFAULT_HOTBAR_ACTIONS.next]: ["ArrowRight", "GamepadRB"],
  [DEFAULT_HOTBAR_ACTIONS.activate]: ["Enter", "GamepadA"],
  [DEFAULT_HOTBAR_ACTIONS.clear]: ["Delete", "GamepadY"],
};

export interface HotbarControlsOptions {
  readonly actions?: HotbarActions;
  /** Default `false`: a pointer press on a slot holds it like a key. */
  readonly dragToSwap?: boolean;
  /** Virtual pixels a pointer moves before a press counts as a drag. Default 6. */
  readonly dragThreshold?: number;
}

/** The default controls, with a switch for drag-to-swap that works while the game runs. */
export interface HotbarControls extends HotbarInputBinding {
  readonly dragToSwap: boolean;
  /** Applies from the next pointer press. A press in progress keeps its mode. */
  setDragToSwap(enabled: boolean): void;
}

/**
 * Number keys activate directly and navigation selects. Letting go of a key
 * that activated a slot releases that slot's action. A pointer press on a
 * slot activates it, and lifting the pointer releases it. With drag-to-swap
 * on, a pointer tap activates and releases at once, and dragging between
 * slots swaps them.
 */
export function hotbarControls(
  options: HotbarControlsOptions = {},
): HotbarControls {
  return new DefaultHotbarInput(
    options.actions ?? DEFAULT_HOTBAR_ACTIONS,
    options.dragThreshold ?? 6,
    options.dragToSwap ?? false,
  );
}

type PointerCommand =
  | { readonly kind: "swap"; readonly from: number; readonly to: number }
  | { readonly kind: "tap"; readonly slot: number }
  | {
      readonly kind: "press";
      readonly slot: number;
      readonly pointer: number;
      readonly generation: number;
    };

/** An input that keeps a slot's action held while it stays down. */
interface HoldSource {
  /** Action name, or pointer id. */
  readonly key: string | number;
  isDown(): boolean;
}

interface PendingPointer {
  readonly id: number;
  readonly generation: number;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

class DefaultHotbarInput implements HotbarControls {
  private input: InputManager | undefined;
  private driver: HotbarDriver | undefined;
  private cleanup: (() => void) | undefined;
  private pending: PendingPointer | undefined;
  private commands: PointerCommand[] = [];
  /** Held actions by the key of the input that started them, released once it is up. */
  private held = new Map<
    string | number,
    { readonly slot: number; readonly source: HoldSource }
  >();

  constructor(
    private readonly actions: HotbarActions,
    private readonly threshold: number,
    private dragging: boolean,
  ) {
    if (!Number.isFinite(threshold) || threshold < 0)
      throw new Error(
        `hotbarControls: dragThreshold must be finite and nonnegative, got ${threshold}`,
      );
  }

  get dragToSwap(): boolean {
    return this.dragging;
  }

  setDragToSwap(enabled: boolean): void {
    this.dragging = enabled;
  }

  bind(
    input: InputManager,
    driver: HotbarDriver,
    target?: Pick<HotbarPresenter, "slotAtPoint">,
  ): void {
    if (this.cleanup)
      throw new Error(
        "hotbarControls: these controls are already bound to a controller. Create one controls object per controller.",
      );
    this.input = input;
    this.driver = driver;
    const isCurrent = () => this.cleanup === cleanup && driver.isInteractive();
    const dragged = (pending: PendingPointer, x: number, y: number) =>
      Math.hypot(x - pending.x, y - pending.y) > this.threshold;
    const down = input.onPointerDown((p) => {
      if (!isCurrent() || p.button !== 0 || input.isPointerConsumed(p.id))
        return;
      const slot = target?.slotAtPoint?.(p.screenPos.x, p.screenPos.y);
      if (slot === undefined || !isCurrent()) return;
      input.consumePointer(p.id);
      if (!this.dragging) {
        this.commands.push({
          kind: "press",
          slot,
          pointer: p.id,
          generation: p.generation,
        });
        return;
      }
      if (this.pending) return;
      this.pending = {
        id: p.id,
        generation: p.generation,
        slot,
        x: p.screenPos.x,
        y: p.screenPos.y,
        moved: false,
      };
    });
    const move = input.onPointerMove((p) => {
      if (this.cleanup !== cleanup) return;
      const pending = this.pending;
      if (pending?.id !== p.id || pending.generation !== p.generation) return;
      if (!driver.isInteractive()) {
        this.pending = undefined;
        return;
      }
      pending.moved ||= dragged(pending, p.screenPos.x, p.screenPos.y);
    });
    const up = input.onPointerUp((p) => {
      if (this.cleanup !== cleanup) return;
      const pending = this.pending;
      if (pending?.id !== p.id || pending.generation !== p.generation) return;
      if (p.button !== 0 && p.button !== -1) return;
      this.pending = undefined;
      if (!driver.isInteractive() || p.button === -1) return;
      const slot = target?.slotAtPoint?.(p.screenPos.x, p.screenPos.y);
      if (slot === undefined || !isCurrent()) return;
      const moved =
        pending.moved || dragged(pending, p.screenPos.x, p.screenPos.y);
      if (slot !== pending.slot && moved)
        this.commands.push({ kind: "swap", from: pending.slot, to: slot });
      else if (slot === pending.slot && !moved)
        this.commands.push({ kind: "tap", slot });
    });
    const cleanup = () => {
      down();
      move();
      up();
    };
    this.cleanup = cleanup;
  }

  poll(): void {
    const { input, driver, cleanup } = this;
    if (!input || !driver || !cleanup || !driver.isInteractive()) {
      this.commands = [];
      this.pending = undefined;
      return;
    }
    // A game callback can dispose or replace this binding during the poll.
    const isCurrent = () => this.cleanup === cleanup && driver.isInteractive();
    // The latest successful activation of a slot owns that slot's hold. A tap
    // (no source) releases at once, and so does an activation that disposed
    // this binding, since nothing is left to see the input go up.
    const press = (slot: number, source?: HoldSource): void => {
      if (!driver.activate(slot).ok) return;
      for (const [key, hold] of this.held)
        if (hold.slot === slot) this.held.delete(key);
      // An input pressed again between polls ends the hold it started
      // before. The new hold is recorded first, so a throwing release still
      // leaves it tracked.
      const earlier = source && this.held.get(source.key);
      if (source && this.cleanup === cleanup)
        this.held.set(source.key, { slot, source });
      else driver.release(slot);
      if (earlier) driver.release(earlier.slot);
    };
    const keyHold = (action: string): HoldSource => ({
      key: action,
      isDown: () => input.isPressed(action),
    });
    const commands = this.commands;
    this.commands = [];
    for (const command of commands) {
      if (!isCurrent()) return;
      if (command.kind === "swap") {
        driver.swap(command.from, command.to);
        continue;
      }
      driver.select(command.slot);
      if (!isCurrent()) return;
      if (command.kind === "tap") press(command.slot);
      else press(command.slot, pointerHold(input, command));
    }
    const slotActions = this.actions.slots.slice(0, driver.slotCount);
    for (const [slot, action] of slotActions.entries()) {
      if (!isCurrent()) return;
      if (input.isJustPressed(action)) {
        driver.select(slot);
        if (!isCurrent()) return;
        press(slot, keyHold(action));
      }
    }
    if (!isCurrent()) return;
    if (input.isJustPressed(this.actions.previous)) driver.cycle(-1);
    else if (input.isJustPressed(this.actions.next)) driver.cycle(1);
    if (!isCurrent()) return;
    if (input.isJustPressed(this.actions.activate))
      press(driver.selection, keyHold(this.actions.activate));
    if (!isCurrent()) return;
    if (input.isJustPressed(this.actions.clear)) driver.clear(driver.selection);
    for (const [key, hold] of [...this.held]) {
      if (!isCurrent()) return;
      if (hold.source.isDown()) continue;
      this.held.delete(key);
      driver.release(hold.slot);
    }
  }

  actionNames(): readonly string[] {
    return [
      ...this.actions.slots,
      this.actions.previous,
      this.actions.next,
      this.actions.activate,
      this.actions.clear,
    ];
  }

  dispose(): void {
    const { driver, held } = this;
    this.cleanup?.();
    this.cleanup = undefined;
    this.pending = undefined;
    this.commands = [];
    this.held = new Map();
    this.input = undefined;
    this.driver = undefined;
    // Reset first: a release callback may bind this input again.
    if (driver) for (const hold of held.values()) driver.release(hold.slot);
  }
}

/** Down while the pointer gesture that pressed the slot keeps button 0 held. */
function pointerHold(
  input: InputManager,
  press: { readonly pointer: number; readonly generation: number },
): HoldSource {
  return {
    key: press.pointer,
    isDown: () => {
      const current = input.getPointer(press.pointer);
      return current?.generation === press.generation && current.buttons.has(0);
    },
  };
}
