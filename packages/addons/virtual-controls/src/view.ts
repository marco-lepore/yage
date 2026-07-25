/**
 * Presentation contracts — pixi-free by design, so the root entry can export
 * them while the implementations live behind `./presenters`. A custom
 * presenter (different art, DOM overlay, debug wireframes) implements these
 * two interfaces; everything else — hit-testing, routing, action mirroring —
 * stays in the headless model.
 */

import type { Scene } from "@yagejs/core";
import type { VirtualButton } from "./core/button.js";
import type { VirtualStick } from "./core/stick.js";

/**
 * One control's visual. Views hold a reference to their control (passed at
 * creation) and poll its state on each `update`: `layout` (the resolved
 * geometry, re-resolved by the model on viewport changes), the stick's
 * `basePos`/`knobPos`/`active`, the button's `pressed`/`label`. All
 * coordinates are VIRTUAL px anchored to the screen — draw on a
 * screen-space render layer, or the visuals will scroll with the world
 * camera.
 */
export interface ControlView {
  /**
   * Called every frame by the component while the scene runs. `dt` is in
   * SECONDS (the engine time unit).
   */
  update(dt: number): void;
  /**
   * Show/hide this control's visuals. The component calls this right after
   * the view is created, so a view needs no default-state guess, and again
   * whenever the overlay is toggled or the host entity goes dormant and comes
   * back. Hidden views should stay cheap.
   */
  setVisible(visible: boolean): void;
  /** Destroy spawned entities / listeners. Must be idempotent. */
  dispose(): void;
}

/**
 * Creates the per-control views. `mount` runs once when the component is
 * added (before any `create*View`) — provision your render layer there (the
 * built-in presenter `ensureLayer`s a screen-space one); `dispose` runs
 * after every view was disposed. The control set is fixed at construction:
 * to change buttons or bindings at runtime, destroy the host entity and add
 * a fresh `VirtualControls`.
 */
export interface ControlsPresenter {
  mount(scene: Scene): void;
  createStickView(stick: VirtualStick): ControlView;
  createButtonView(button: VirtualButton): ControlView;
  dispose(): void;
}
