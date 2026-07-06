/**
 * Adapter-level presenter contracts. The headless channels (core/session)
 * describe *what* a slots / detail / menu presenter does; these add the YAGE
 * lifecycle (`mount(scene)` / `dispose()`) the host drives, plus the pointer
 * hit-test seams a pointer binding needs. The built-in renderer presenter
 * (`SlotsView`, driven by a swappable `CellPresenter`) implements these; a DOM
 * or ui-react panel implements the same shape.
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
  SlotView,
} from "./core/session.js";

/** A laid-out rectangle (screen px) — the shared currency between the panel
 *  layout, the cells it places, and the pointer hit-tests. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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

/** The slot surface — a windowed grid of cells (a list is one column of wide
 *  cells). Optionally hit-tests pointer coords so a pointer binding can
 *  hover/click cells without owning their geometry. */
export interface SlotsPresenter<TId extends string = string>
  extends SlotsChannel<TId>,
    Mountable {
  /** Slot index under this point, or undefined. Omit for no pointer support. */
  slotAtPoint?(x: number, y: number): number | undefined;
  /** Coordinate space `slotAtPoint` expects. Default "screen". */
  readonly pointerSpace?: "screen" | "world" | undefined;
  /** The selected cell's screen rect (the action menu anchors to it), or
   *  undefined when the selection is scrolled out. Omit for no anchoring. */
  selectionAnchor?(): Rect | undefined;
}

/** Cell geometry a {@link CellPresenter} supplies when the factory options
 *  leave a knob unset. Pure defaults — the panel's constraint solver may
 *  override any of them (deriving a count from `bounds`, say). */
export interface CellDefaults {
  readonly columns: number;
  readonly visibleRows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gapX: number;
  readonly gapY: number;
}

/** One live rendered cell. The view drives selection and visibility through
 *  the handle so neither respawns the cell's content. */
export interface CellHandle {
  /** Redraw the selection visual (outline / bar) — cheap, no content respawn. */
  setSelected(selected: boolean): void;
  /** Show or hide every display object this cell spawned. */
  setVisible(visible: boolean): void;
  /** Destroy every entity this cell spawned. */
  dispose(): void;
}

/**
 * The swappable per-cell renderer. It owns the cell's background, content, and
 * selection visual; the view owns placement, windowing, scroll hints, and
 * lifecycle. Swapping the presenter is what turns a grid of icon tiles into a
 * list of text rows — no branching in the view.
 */
export interface CellPresenter<TId extends string = string> {
  /** Cell geometry used for any axis the factory options leave unset. */
  readonly defaults: CellDefaults;
  /**
   * Spawn one cell's visuals into `rect`. Called for EVERY windowed slot,
   * including empty ones (`view.stack === null`) — an empty cell still shows
   * its background and can be selected. Spawn order inside the handle is paint
   * order: background/selection graphics first, content on top.
   */
  renderCell(scene: Scene, view: SlotView<TId>, rect: Rect, selected: boolean): CellHandle;
  /** Optional diagnostics sink pass-through (e.g. an unresolvable icon key). */
  setDiagnostics?(warn: DiagnosticSink): void;
  /** Optional preset-level teardown (a texture cache, say). */
  dispose?(): void;
}

/** One row an action-menu skin draws: its rect (which the view also
 *  hit-tests) and the label to render inside it. */
export interface MenuSkinRow {
  readonly rect: Rect;
  readonly label: string;
}

/** One live rendered action menu. The view measured labels, placed the menu
 *  (flip/clamp into the panel), and computed the row rects; the skin drew
 *  them. The view drives the highlight and visibility through this handle,
 *  which never respawns — mirrors {@link CellHandle}. */
export interface MenuSkinHandle {
  /** Retint the labels and move the bar to row `position`. */
  highlight(position: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * The swappable action-menu renderer. The view owns label measurement,
 * placement, row-rect computation, and pointer hit-testing; the skin owns the
 * frame / label / highlight-bar drawing. Swapping it restyles the menu without
 * reimplementing placement — the {@link CellPresenter} pattern for the popup.
 */
export interface MenuSkinPresenter {
  /** Draw the menu frame and its rows. `menu` is the outer frame rect; each
   *  `rows[i].rect` is the same rect the view hit-tests. */
  renderMenu(scene: Scene, menu: Rect, rows: readonly MenuSkinRow[]): MenuSkinHandle;
}

/** Which scroll directions have rows past the window, plus the cell-window
 *  rect the hints sit against. */
export interface HintsState {
  /** Rows are scrolled off the top. */
  readonly up: boolean;
  /** Rows are scrolled off the bottom. */
  readonly down: boolean;
  readonly window: Rect;
}

/** One live rendered scroll-hint set — the view redraws it through the handle
 *  as the window scrolls. */
export interface HintsHandle {
  update(state: HintsState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * The swappable scroll-hint renderer. The view computes what is scrolled out
 * of view; the preset draws the affordance (the default ▲/▼ triangles, or
 * dots, a scrollbar, …). Swap it via `createInventoryPanel(theme, { hints })`.
 */
export interface HintsPresenter {
  render(scene: Scene, state: HintsState): HintsHandle;
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
 * The presenter set a factory assembles (see `createInventoryPanel` on the
 * `/presenters` entry). Only `slots` is required: an embedded integration
 * renders cells inside its own menu and omits the chrome (and whatever else
 * its host UI already provides).
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
