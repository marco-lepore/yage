/**
 * Pure cell math for {@link SlotsView}: index ↔ row/column mapping, cursor
 * navigation (clamped or wrapping), the integer-row scroll window, cell rects,
 * and pointer hit-testing. Everything renders FROM these functions, so
 * placement, the cursor, scrolling, and hit-tests can't desync — and it all
 * unit-tests without a renderer.
 *
 * One `columns × visibleRows` window covers every layout: a list is
 * `columns: 1` with wide, short cells; a text menu is `columns: 2`; a classic
 * grid is square cells. Cells carry independent width/height and per-axis gaps,
 * so none of these is a special case.
 */

export type { Rect } from "../adapter.js";
import type { Rect } from "../adapter.js";

export interface CellGridSpec {
  readonly columns: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gapX: number;
  readonly gapY: number;
  /** Scroll-window height in rows. */
  readonly visibleRows: number;
}

export function cellRowOf(index: number, columns: number): number {
  return Math.floor(index / columns);
}

export function cellColOf(index: number, columns: number): number {
  return index % columns;
}

/** Total rows needed for `count` cells. */
export function cellRowCount(count: number, columns: number): number {
  return Math.ceil(count / columns);
}

/**
 * The cursor's next cell moving `dir` from `from` over `count` cells.
 * Up/down move by column; left/right stay within the row. Edges clamp
 * (`from` back) unless `wrap`: horizontal wraps within the row, vertical
 * within the column. Moving down into a shorter last row snaps to its last
 * cell (the cursor never lands off-grid). At `columns: 1` this is linear
 * up/down navigation with left/right as no-ops — a list.
 */
export function cellNavigate(
  from: number,
  dir: "up" | "down" | "left" | "right",
  count: number,
  columns: number,
  wrap = false,
): number {
  if (count <= 0) return from;
  const col = cellColOf(from, columns);
  const lastRow = cellRowCount(count, columns) - 1;
  switch (dir) {
    case "up": {
      const t = from - columns;
      if (t >= 0) return t;
      if (!wrap) return from;
      // Bottom-most cell in this column.
      const bottom = col + columns * lastRow;
      return bottom < count ? bottom : bottom - columns;
    }
    case "down": {
      const t = from + columns;
      if (t < count) return t;
      if (wrap) return col;
      // A shorter last row: snap onto its end rather than refusing the move.
      return cellRowOf(from, columns) < lastRow ? count - 1 : from;
    }
    case "left": {
      if (col > 0) return from - 1;
      if (!wrap) return from;
      return Math.min(from + columns - 1, count - 1); // end of this row
    }
    case "right": {
      if (col < columns - 1 && from + 1 < count) return from + 1;
      return wrap ? from - col : from; // start of this row
    }
  }
}

/** The scroll window's first row after moving the cursor to `selected`,
 *  shifted just enough to keep the selected row visible. */
export function cellScrollRow(
  selected: number,
  scrollRow: number,
  visibleRows: number,
  columns: number,
  count: number,
): number {
  const row = cellRowOf(selected, columns);
  const maxFirst = Math.max(0, cellRowCount(count, columns) - visibleRows);
  let first = Math.min(scrollRow, maxFirst);
  if (row < first) first = row;
  else if (row >= first + visibleRows) first = row - visibleRows + 1;
  return Math.max(0, Math.min(first, maxFirst));
}

/** The cell rect for `index` given the window, or null when scrolled out. */
export function cellRect(
  index: number,
  spec: CellGridSpec,
  origin: { readonly x: number; readonly y: number },
  scrollRow: number,
): Rect | null {
  const row = cellRowOf(index, spec.columns);
  if (row < scrollRow || row >= scrollRow + spec.visibleRows) return null;
  const col = cellColOf(index, spec.columns);
  return {
    x: origin.x + col * (spec.cellWidth + spec.gapX),
    y: origin.y + (row - scrollRow) * (spec.cellHeight + spec.gapY),
    width: spec.cellWidth,
    height: spec.cellHeight,
  };
}

/** The cell index under a point, or undefined (gaps between cells miss). */
export function cellAtPoint(
  x: number,
  y: number,
  spec: CellGridSpec,
  origin: { readonly x: number; readonly y: number },
  scrollRow: number,
  count: number,
): number | undefined {
  const stepX = spec.cellWidth + spec.gapX;
  const stepY = spec.cellHeight + spec.gapY;
  const lx = x - origin.x;
  const ly = y - origin.y;
  if (lx < 0 || ly < 0) return undefined;
  const col = Math.floor(lx / stepX);
  const row = Math.floor(ly / stepY);
  if (col >= spec.columns || row >= spec.visibleRows) return undefined;
  // Points inside a cell's gap fall between cells and miss. With `gap: 0`
  // (flush rows/cells) this never triggers — the whole step is the cell.
  if (lx - col * stepX > spec.cellWidth || ly - row * stepY > spec.cellHeight) return undefined;
  const index = (row + scrollRow) * spec.columns + col;
  return index < count ? index : undefined;
}

/** Pixel size of the visible cell window. */
export function cellWindowSize(spec: CellGridSpec): { width: number; height: number } {
  return {
    width: spec.columns * (spec.cellWidth + spec.gapX) - spec.gapX,
    height: spec.visibleRows * (spec.cellHeight + spec.gapY) - spec.gapY,
  };
}
