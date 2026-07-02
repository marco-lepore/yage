/**
 * Pure list math for {@link ListSlotsView}: linear navigation, the integer
 * scroll window, row rects, and pointer hit-testing — the single geometry
 * source its rendering, cursor, and hit-tests all consume.
 */

import type { Rect } from "./gridGeometry.js";

export interface ListSpec {
  readonly rowHeight: number;
  /** Scroll-window height in rows. */
  readonly visibleRows: number;
}

/** Up/down move the cursor by one (wrapping when asked); left/right don't
 *  navigate a list. */
export function listNavigate(
  from: number,
  dir: "up" | "down" | "left" | "right",
  count: number,
  wrap = false,
): number {
  if (count <= 0 || dir === "left" || dir === "right") return from;
  const delta = dir === "up" ? -1 : 1;
  const t = from + delta;
  if (t < 0) return wrap ? count - 1 : from;
  if (t >= count) return wrap ? 0 : from;
  return t;
}

/** The scroll window's first row after moving the cursor to `selected`. */
export function listScrollOffset(
  selected: number,
  offset: number,
  visibleRows: number,
  count: number,
): number {
  const maxFirst = Math.max(0, count - visibleRows);
  let first = Math.min(offset, maxFirst);
  if (selected < first) first = selected;
  else if (selected >= first + visibleRows) first = selected - visibleRows + 1;
  return Math.max(0, Math.min(first, maxFirst));
}

/** The row rect for `index` given the window, or null when scrolled out. */
export function listRowRect(
  index: number,
  spec: ListSpec,
  origin: { readonly x: number; readonly y: number },
  offset: number,
  width: number,
): Rect | null {
  if (index < offset || index >= offset + spec.visibleRows) return null;
  return {
    x: origin.x,
    y: origin.y + (index - offset) * spec.rowHeight,
    width,
    height: spec.rowHeight,
  };
}

/** The row index under a point, or undefined. */
export function listRowAtPoint(
  x: number,
  y: number,
  spec: ListSpec,
  origin: { readonly x: number; readonly y: number },
  offset: number,
  count: number,
  width: number,
): number | undefined {
  if (x < origin.x || x > origin.x + width) return undefined;
  const row = Math.floor((y - origin.y) / spec.rowHeight);
  if (y < origin.y || row >= spec.visibleRows) return undefined;
  const index = row + offset;
  return index < count ? index : undefined;
}
