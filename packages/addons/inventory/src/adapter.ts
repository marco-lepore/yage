/**
 * Adapter-level presenter contracts. The headless channels (core/session)
 * describe *what* a slots / detail / menu presenter does; these add the YAGE
 * lifecycle (`mount(scene)` / `dispose()`) the host drives, plus the pointer
 * hit-test seams a pointer binding needs. Concrete renderer presenters
 * (`GridSlotsView`, `ListSlotsView`, …) implement these; a DOM or ui-react
 * panel implements the same shape.
 *
 * This module is pixi-free on purpose: the root entry reaches presenter
 * CONTRACTS through it without transitively importing `@yagejs/renderer`.
 */

import type { Scene } from "@yagejs/core";
import type {
  ActionMenuChannel,
  DetailChannel,
  InventoryChromeChannel,
  SlotsChannel,
} from "./core/session.js";

/** A dev-facing diagnostics sink — the controller wires this to the engine
 *  Logger, so a presenter-level warning (e.g. an unresolvable icon) routes
 *  there instead of `console.warn`. */
export type DiagnosticSink = (message: string) => void;

/** YAGE lifecycle shared by the renderer-based presenters. */
export interface Mountable {
  mount(scene: Scene): void;
  dispose(): void;
  /** Optional: receive a diagnostics sink, injected by the controller at
   *  mount. Presenters with nothing to report omit it. */
  setDiagnostics?(warn: DiagnosticSink): void;
}

/** The slot surface (grid / list). Optionally hit-tests pointer coords so a
 *  pointer binding can hover/click cells without owning their geometry. */
export interface SlotsPresenter<TId extends string = string>
  extends SlotsChannel<TId>,
    Mountable {
  /** Slot index under this point, or undefined. Omit for no pointer support. */
  slotAtPoint?(x: number, y: number): number | undefined;
  /** Coordinate space `slotAtPoint` expects. Default "screen". */
  readonly pointerSpace?: "screen" | "world" | undefined;
}

/** The selected-item pane. */
export interface DetailPresenter<TId extends string = string>
  extends DetailChannel<TId>,
    Mountable {}

/** The per-item action popup, with the pointer hit-test seam for its rows. */
export interface ActionMenuPresenter extends ActionMenuChannel, Mountable {
  /** Menu row under this point, or undefined. */
  actionAtPoint?(x: number, y: number): number | undefined;
}

/** The panel frame + header. */
export interface ChromePresenter extends InventoryChromeChannel, Mountable {}

/**
 * The presenter set a factory assembles (see `createGridInventory` /
 * `createListInventory` on the `/presenters` entry). Only `slots` is
 * required: an embedded integration renders cells inside its own menu and
 * omits the chrome (and whatever else its host UI already provides).
 *
 * Optional fields are `T | undefined` so factories and games can assign
 * possibly-undefined values directly (exactOptionalPropertyTypes).
 */
export interface InventoryBundle<TId extends string = string> {
  readonly slots: SlotsPresenter<TId>;
  readonly chrome?: ChromePresenter | undefined;
  readonly detail?: DetailPresenter<TId> | undefined;
  readonly actionMenu?: ActionMenuPresenter | undefined;
}
