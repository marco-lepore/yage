/**
 * SlotsView — the one slot surface. A windowed `columns × visibleRows` grid of
 * cells with integer-row scrolling, scroll hints, and a selection cursor. It
 * owns placement, windowing, and lifecycle; a swappable {@link CellPresenter}
 * owns what each cell looks like. A "list" is `columns: 1` with a row-drawing
 * cell — no grid-vs-list branching lives here.
 *
 * All geometry comes from `cellGeometry.ts`, so placement, the cursor,
 * scrolling, and pointer hit-tests can't desync. Each model change rebuilds the
 * visible cells wholesale (dispose + respawn); a selection move that stays in
 * the window only redraws the two affected cells.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, RendererKey } from "@yagejs/renderer";
import type { SlotView } from "../core/session.js";
import type { CellHandle, CellPresenter, DiagnosticSink, SlotsPresenter, Rect } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import {
  cellAtPoint,
  cellNavigate,
  cellRect,
  cellRowCount,
  cellScrollRow,
  cellWindowSize,
  type CellGridSpec,
} from "./cellGeometry.js";

export interface SlotsViewConfig {
  readonly columns: number;
  readonly visibleRows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gapX: number;
  readonly gapY: number;
  /** Wrap cursor navigation at edges. Default false (clamp). */
  readonly wrap?: boolean | undefined;
  /** Scroll-hint (▲/▼) color. */
  readonly hintColor: number;
  /** Scroll-hint fill alpha. */
  readonly hintAlpha: number;
  /** Everything the view and its cells draw sit on ONE layer, stacked by
   *  spawn order. The chrome frame lives on the lower panel layer. */
  readonly layerContent: string;
  /** Warnings the factory composed (e.g. an overdetermined geometry), emitted
   *  once at mount through the diagnostics sink. */
  readonly mountWarnings?: readonly string[] | undefined;
}

export class SlotsView<TId extends string = string> implements SlotsPresenter<TId> {
  private scene?: Scene | undefined;
  private warn?: DiagnosticSink | undefined;
  private slots: readonly SlotView<TId>[] = [];
  private selected = 0;
  private scrollRow = 0;
  private hidden = true;

  private hints?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  /** slot index → its live cell. */
  private readonly handles = new Map<number, CellHandle>();
  private layoutUnsub: (() => void) | undefined;

  onSlotChosen?: (slot: number) => void;

  constructor(
    private readonly cfg: SlotsViewConfig,
    private readonly cell: CellPresenter<TId>,
    private readonly layout: PanelLayout,
  ) {}

  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
    this.cell.setDiagnostics?.(warn);
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    // Scroll hints sit outside the window rect, so their spawn-first paint
    // order never fights the cells.
    const hints = scene.spawn("inv-slots-hints");
    hints.add(new Transform());
    this.hints = {
      entity: hints,
      gfx: hints.add(new GraphicsComponent({ layer: this.cfg.layerContent })),
    };
    this.layoutUnsub = this.layout.onChange(() => this.rebuild());
    for (const message of this.cfg.mountWarnings ?? []) this.warn?.(message);
    this.warnIfOverflowing();
  }

  present(slots: readonly SlotView<TId>[]): void {
    this.slots = slots;
    this.scrollRow = cellScrollRow(
      this.selected,
      this.scrollRow,
      this.cfg.visibleRows,
      this.cfg.columns,
      slots.length,
    );
    this.rebuild();
  }

  setSelected(slot: number): void {
    const prev = this.selected;
    this.selected = slot;
    const next = cellScrollRow(
      slot,
      this.scrollRow,
      this.cfg.visibleRows,
      this.cfg.columns,
      this.slots.length,
    );
    if (next !== this.scrollRow) {
      this.scrollRow = next;
      this.rebuild(); // the window moved — cells re-place
    } else {
      this.handles.get(prev)?.setSelected(false);
      this.handles.get(slot)?.setSelected(true);
    }
  }

  navigate(from: number, dir: "up" | "down" | "left" | "right"): number {
    return cellNavigate(from, dir, this.slots.length, this.cfg.columns, this.cfg.wrap ?? false);
  }

  slotAtPoint(x: number, y: number): number | undefined {
    return cellAtPoint(x, y, this.spec(), this.origin(), this.scrollRow, this.slots.length);
  }

  selectionAnchor(): Rect | undefined {
    return cellRect(this.selected, this.spec(), this.origin(), this.scrollRow) ?? undefined;
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  clear(): void {
    this.slots = [];
    for (const h of this.handles.values()) h.dispose();
    this.handles.clear();
    this.hints?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.hints?.entity.destroy();
    this.hints = undefined;
    this.cell.dispose?.();
    this.layoutUnsub?.();
    this.layoutUnsub = undefined;
    this.scene = undefined;
  }

  // ------------------------------------------------------------- internals

  private spec(): CellGridSpec {
    return {
      columns: this.cfg.columns,
      cellWidth: this.cfg.cellWidth,
      cellHeight: this.cfg.cellHeight,
      gapX: this.cfg.gapX,
      gapY: this.cfg.gapY,
      visibleRows: this.cfg.visibleRows,
    };
  }

  /** Window top-left: the content rect, window centered in it on both axes. */
  private origin(): { x: number; y: number } {
    const content = this.layout.contentRect();
    const size = cellWindowSize(this.spec());
    return {
      x: content.x + Math.max(0, Math.round((content.width - size.width) / 2)),
      y: content.y + Math.max(0, Math.round((content.height - size.height) / 2)),
    };
  }

  private rebuild(): void {
    if (!this.scene) return;
    for (const h of this.handles.values()) h.dispose();
    this.handles.clear();

    const origin = this.origin();
    const spec = this.spec();
    const scene = this.scene;
    for (const view of this.slots) {
      const r = cellRect(view.slot, spec, origin, this.scrollRow);
      if (!r) continue;
      this.handles.set(view.slot, this.cell.renderCell(scene, view, r, view.slot === this.selected));
    }
    this.drawHints(origin);
    this.applyHidden();
  }

  /** Small ▲/▼ hints at the window's right edge when rows are scrolled out. */
  private drawHints(origin: { x: number; y: number }): void {
    const size = cellWindowSize(this.spec());
    const totalRows = cellRowCount(this.slots.length, this.cfg.columns);
    const x = origin.x + size.width + 6;
    this.hints?.gfx.draw((g) => {
      g.clear();
      if (this.scrollRow > 0) {
        g.moveTo(x, origin.y + 6)
          .lineTo(x + 8, origin.y + 6)
          .lineTo(x + 4, origin.y)
          .closePath()
          .fill({ color: this.cfg.hintColor, alpha: this.cfg.hintAlpha });
      }
      if (this.scrollRow + this.cfg.visibleRows < totalRows) {
        const y = origin.y + size.height;
        g.moveTo(x, y - 6)
          .lineTo(x + 8, y - 6)
          .lineTo(x + 4, y)
          .closePath()
          .fill({ color: this.cfg.hintColor, alpha: this.cfg.hintAlpha });
      }
    });
  }

  private applyHidden(): void {
    const visible = !this.hidden;
    if (this.hints) this.hints.gfx.graphics.visible = visible;
    for (const h of this.handles.values()) h.setVisible(visible);
  }

  /** Dev aid: a window larger than the content rect (an embedded `bounds` too
   *  small for `columns × visibleRows`) renders clipped — say so instead of
   *  leaving a silently overflowing panel. */
  private warnIfOverflowing(): void {
    const size = cellWindowSize(this.spec());
    const content = this.layout.contentRect();
    if (size.width > content.width + 1 || size.height > content.height + 1) {
      this.warn?.(
        `inventory panel window (${size.width}×${size.height}px for ${this.cfg.columns} columns × ` +
          `${this.cfg.visibleRows} rows) overflows its panel content area ` +
          `(${Math.round(content.width)}×${Math.round(content.height)}px) — enlarge the bounds ` +
          `or reduce columns/visibleRows`,
      );
    }
  }
}
