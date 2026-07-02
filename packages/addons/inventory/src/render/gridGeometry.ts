/**
 * Pure grid math for {@link GridSlotsView}: index ↔ row/column mapping,
 * cursor navigation (clamped or wrapping), the integer-row scroll window,
 * cell rects, and pointer hit-testing. Everything renders FROM these
 * functions, so placement, the cursor, scrolling, and hit-tests can't desync
 * — and it all unit-tests without a renderer.
 */

/** A laid-out rectangle (screen px). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GridSpec {
  readonly columns: number;
  readonly cellSize: number;
  readonly cellGap: number;
  /** Scroll-window height in rows. */
  readonly visibleRows: number;
}

export function gridRowOf(index: number, columns: number): number {
  return Math.floor(index / columns);
}

export function gridColOf(index: number, columns: number): number {
  return index % columns;
}

/** Total rows needed for `count` cells. */
export function gridRows(count: number, columns: number): number {
  return Math.ceil(count / columns);
}

/**
 * The cursor's next cell moving `dir` from `from` over `count` cells.
 * Up/down move by column; left/right stay within the row. Edges clamp
 * (`from` back) unless `wrap`: horizontal wraps within the row, vertical
 * within the column. Moving down into a shorter last row snaps to its last
 * cell (the cursor never lands off-grid).
 */
export function gridNavigate(
  from: number,
  dir: "up" | "down" | "left" | "right",
  count: number,
  columns: number,
  wrap = false,
): number {
  if (count <= 0) return from;
  const col = gridColOf(from, columns);
  const lastRow = gridRows(count, columns) - 1;
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
      return gridRowOf(from, columns) < lastRow ? count - 1 : from;
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
export function gridScrollRow(
  selected: number,
  scrollRow: number,
  visibleRows: number,
  columns: number,
  count: number,
): number {
  const row = gridRowOf(selected, columns);
  const maxFirst = Math.max(0, gridRows(count, columns) - visibleRows);
  let first = Math.min(scrollRow, maxFirst);
  if (row < first) first = row;
  else if (row >= first + visibleRows) first = row - visibleRows + 1;
  return Math.max(0, Math.min(first, maxFirst));
}

/** The cell rect for `index` given the window, or null when scrolled out. */
export function gridCellRect(
  index: number,
  spec: GridSpec,
  origin: { readonly x: number; readonly y: number },
  scrollRow: number,
): Rect | null {
  const row = gridRowOf(index, spec.columns);
  if (row < scrollRow || row >= scrollRow + spec.visibleRows) return null;
  const col = gridColOf(index, spec.columns);
  const step = spec.cellSize + spec.cellGap;
  return {
    x: origin.x + col * step,
    y: origin.y + (row - scrollRow) * step,
    width: spec.cellSize,
    height: spec.cellSize,
  };
}

/** The cell index under a point, or undefined (gaps between cells miss). */
export function gridSlotAtPoint(
  x: number,
  y: number,
  spec: GridSpec,
  origin: { readonly x: number; readonly y: number },
  scrollRow: number,
  count: number,
): number | undefined {
  const step = spec.cellSize + spec.cellGap;
  const lx = x - origin.x;
  const ly = y - origin.y;
  if (lx < 0 || ly < 0) return undefined;
  const col = Math.floor(lx / step);
  const row = Math.floor(ly / step);
  if (col >= spec.columns || row >= spec.visibleRows) return undefined;
  if (lx - col * step > spec.cellSize || ly - row * step > spec.cellSize) return undefined;
  const index = (row + scrollRow) * spec.columns + col;
  return index < count ? index : undefined;
}

/** Pixel size of the visible grid window. */
export function gridWindowSize(spec: GridSpec): { width: number; height: number } {
  const step = spec.cellSize + spec.cellGap;
  return {
    width: spec.columns * step - spec.cellGap,
    height: spec.visibleRows * step - spec.cellGap,
  };
}
