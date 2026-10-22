import type { Scene } from "@yagejs/core";
import type { InputManager } from "@yagejs/input";
import type { HotbarActionResult, HotbarState } from "./core/types.js";

export interface HotbarPresenter {
  /** Spawn display entities into the scene. They do not follow the controller's entity. */
  mount(scene: Scene): void;
  present(state: HotbarState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  /** Virtual screen coordinates, shared with InputManager's pointer snapshots. */
  slotAtPoint?(x: number, y: number): number | undefined;
}

/**
 * The bar as an input binding sees it. While the controller is inactive,
 * selection, assignment and activation calls do nothing, and `activate`
 * rejects with `"inactive"`. `release` always reaches the model.
 */
export interface HotbarDriver {
  readonly slotCount: number;
  readonly selection: number;
  isInteractive(): boolean;
  select(slot: number): void;
  cycle(direction: -1 | 1): void;
  activate(slot?: number): HotbarActionResult;
  release(slot: number): void;
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
  /** Remove listeners and release the held actions this binding activated. */
  dispose(): void;
  actionNames?(): readonly string[];
}
