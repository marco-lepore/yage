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
  "hotbar-previous": ["ArrowLeft", "GamepadLB"],
  "hotbar-next": ["ArrowRight", "GamepadRB"],
  "hotbar-activate": ["Enter", "GamepadA"],
  "hotbar-clear": ["Delete", "GamepadY"],
};

/** Number keys activate directly; navigation selects; pointer release activates or swaps. */
export function hotbarControls(
  options: {
    readonly actions?: HotbarActions;
    readonly dragThreshold?: number;
  } = {},
): HotbarInputBinding {
  return new DefaultHotbarInput(
    options.actions ?? DEFAULT_HOTBAR_ACTIONS,
    options.dragThreshold ?? 6,
  );
}

class DefaultHotbarInput implements HotbarInputBinding {
  private input: InputManager | undefined;
  private driver: HotbarDriver | undefined;
  private cleanup: (() => void) | undefined;
  private pending:
    | {
        id: number;
        generation: number;
        slot: number;
        x: number;
        y: number;
        moved: boolean;
      }
    | undefined;
  private commands: { from: number; to: number; moved: boolean }[] = [];

  constructor(
    private readonly actions: HotbarActions,
    private readonly threshold: number,
  ) {
    if (!Number.isFinite(threshold) || threshold < 0)
      throw new Error(
        `hotbarControls: dragThreshold must be finite and nonnegative, got ${threshold}`,
      );
  }

  bind(
    input: InputManager,
    driver: HotbarDriver,
    target?: Pick<HotbarPresenter, "slotAtPoint">,
  ): void {
    this.dispose();
    this.input = input;
    this.driver = driver;
    const isCurrent = () => this.cleanup === cleanup && driver.isInteractive();
    const down = input.onPointerDown((p) => {
      if (!isCurrent() || p.button !== 0 || input.isPointerConsumed(p.id))
        return;
      const slot = target?.slotAtPoint?.(p.screenPos.x, p.screenPos.y);
      if (slot === undefined || !isCurrent()) return;
      input.consumePointer(p.id);
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
      pending.moved ||=
        Math.hypot(p.screenPos.x - pending.x, p.screenPos.y - pending.y) >
        this.threshold;
    });
    const up = input.onPointerUp((p) => {
      if (this.cleanup !== cleanup) return;
      const pending = this.pending;
      if (pending?.id !== p.id || pending.generation !== p.generation) return;
      if (p.button !== 0 && p.button !== -1) return;
      this.pending = undefined;
      if (!driver.isInteractive() || p.button === -1) return;
      const slot = target?.slotAtPoint?.(p.screenPos.x, p.screenPos.y);
      if (slot !== undefined && isCurrent())
        this.commands.push({
          from: pending.slot,
          to: slot,
          moved:
            pending.moved ||
            Math.hypot(p.screenPos.x - pending.x, p.screenPos.y - pending.y) >
              this.threshold,
        });
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
    const commands = this.commands;
    this.commands = [];
    for (const command of commands) {
      if (!isCurrent()) return;
      if (command.from !== command.to && command.moved)
        driver.swap(command.from, command.to);
      else if (command.from === command.to && !command.moved) {
        driver.select(command.to);
        if (!isCurrent()) return;
        driver.activate(command.to);
      }
    }
    for (
      let slot = 0;
      slot < Math.min(driver.slotCount, this.actions.slots.length);
      slot++
    ) {
      if (!isCurrent()) return;
      if (input.isJustPressed(this.actions.slots[slot]!)) {
        driver.select(slot);
        if (!isCurrent()) return;
        driver.activate(slot);
      }
    }
    if (!isCurrent()) return;
    if (input.isJustPressed(this.actions.previous)) driver.cycle(-1);
    else if (input.isJustPressed(this.actions.next)) driver.cycle(1);
    if (!isCurrent()) return;
    if (input.isJustPressed(this.actions.activate)) driver.activate();
    if (!isCurrent()) return;
    if (input.isJustPressed(this.actions.clear)) driver.clear(driver.selection);
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
    this.cleanup?.();
    this.cleanup = undefined;
    this.pending = undefined;
    this.commands = [];
    this.input = undefined;
    this.driver = undefined;
  }
}
