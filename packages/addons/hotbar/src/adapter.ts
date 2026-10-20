import type { Entity } from "@yagejs/core";
import type { InputManager } from "@yagejs/input";
import type { HotbarActionResult, HotbarState } from "./core/types.js";

export interface HotbarPresenter {
  mount(owner: Entity): void;
  present(state: HotbarState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  /** Virtual screen coordinates, shared with InputManager's pointer snapshots. */
  slotAtPoint?(x: number, y: number): number | undefined;
}

export interface HotbarDriver {
  readonly slotCount: number;
  readonly selection: number;
  isInteractive(): boolean;
  select(slot: number): void;
  cycle(direction: -1 | 1): void;
  activate(slot?: number): HotbarActionResult;
  clear(slot: number): void;
  swap(a: number, b: number): void;
}

export interface HotbarInputBinding {
  bind(
    input: InputManager,
    driver: HotbarDriver,
    target?: Pick<HotbarPresenter, "slotAtPoint">,
  ): void;
  poll(): void;
  dispose(): void;
  actionNames?(): readonly string[];
}
