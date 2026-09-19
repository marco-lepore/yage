import type { FocusDirection } from "../types.js";

/** A candidate's box, in whatever space the caller measured every box in. */
export interface FocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Unit vector per direction. `dy !== 0` marks a move along the y axis. */
const AXIS: Record<
  FocusDirection,
  { readonly dx: number; readonly dy: number }
> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Slack on the "is it in that direction" test, in px. A box level with the
 * focused one is never below it, and half a pixel absorbs the rounding a
 * layout pass leaves behind.
 */
const AHEAD_EPSILON = 0.5;

/**
 * Weight on the sideways distance for a box that shares neither row nor
 * column with the focused one, so a box nearly straight ahead beats a closer
 * one far off to the side.
 */
const ACROSS_WEIGHT = 2;

/** Whether two spans on one axis overlap. */
function overlaps(
  start: number,
  size: number,
  otherStart: number,
  otherSize: number,
): boolean {
  return start < otherStart + otherSize && otherStart < start + size;
}

/**
 * Index of the best box on one side of `focused`, or `-1`. `behind` searches
 * the boxes the direction points away from, which is what wrapping needs.
 *
 * Boxes overlapping the focused box on the perpendicular axis — the same
 * column for a vertical move, the same row for a horizontal one — win as a
 * group whenever the group is not empty. Ties break by array index, which the
 * caller fills in tree order, so the result is stable frame to frame.
 */
function search(
  rects: readonly FocusRect[],
  focused: FocusRect,
  dx: number,
  dy: number,
  behind: boolean,
): number {
  const vertical = dy !== 0;
  const cx = focused.x + focused.width / 2;
  const cy = focused.y + focused.height / 2;
  let best = -1;
  let bestAligned = false;
  let bestScore = 0;
  for (const [index, rect] of rects.entries()) {
    // The focused box scores `along === 0`, so it is neither ahead nor
    // behind and can never win its own move.
    const ox = rect.x + rect.width / 2 - cx;
    const oy = rect.y + rect.height / 2 - cy;
    const along = ox * dx + oy * dy;
    if (behind ? along >= 0 : along <= AHEAD_EPSILON) continue;
    const across = Math.abs(vertical ? ox : oy);
    const aligned = vertical
      ? overlaps(rect.x, rect.width, focused.x, focused.width)
      : overlaps(rect.y, rect.height, focused.y, focused.height);
    // Lowest score wins. Behind, `along` is negative, so the lowest is the
    // box furthest away — the far end the cursor wraps around to.
    const score = behind || aligned ? along : along + ACROSS_WEIGHT * across;
    const better =
      best === -1 || (aligned !== bestAligned ? aligned : score < bestScore);
    if (!better) continue;
    best = index;
    bestAligned = aligned;
    bestScore = score;
  }
  return best;
}

/**
 * The index of the rectangle a move in `direction` lands on, or `-1` when the
 * move is blocked. `from` is `-1` when nothing is focused, which returns `0`
 * for a non-empty list whatever the direction.
 */
export function pickNeighbor(
  rects: readonly FocusRect[],
  from: number,
  direction: FocusDirection,
  wrap: boolean,
): number {
  if (rects.length === 0) return -1;
  if (from < 0) return 0;
  const focused = rects[from];
  if (focused === undefined) {
    throw new Error(
      `pickNeighbor: from must be -1 or an index into rects, got ${from}.`,
    );
  }
  const { dx, dy } = AXIS[direction];
  const ahead = search(rects, focused, dx, dy, false);
  if (ahead !== -1) return ahead;
  return wrap ? search(rects, focused, dx, dy, true) : -1;
}
