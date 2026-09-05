import type { LevelPoint } from "@yagejs/level/document";
import { unionBounds, type WorldBounds } from "./bounds.js";

/**
 * Lining a selection up, over rectangles alone.
 *
 * The preview measures — only it knows what a placement actually draws — and
 * the controller writes the answer into local transforms. What is left in the
 * middle is arithmetic over boxes, which is what lives here: no document, no
 * entity, no store.
 */

/**
 * Which line of the selection's box every member lands on: a side of it, or
 * its middle on one axis.
 */
export type AlignEdge =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

/** The axis a distribution spreads along. */
export type ArrangeAxis = "x" | "y";

/**
 * How far each named box has to move, in world units.
 *
 * A member already where it belongs is still an entry, at zero: the caller
 * decides what an unmoved placement costs, and for a command that is nothing
 * at all.
 */
export type ArrangeMoves = ReadonlyMap<string, LevelPoint>;

/** The axis an alignment moves the selection along. */
export function edgeAxis(edge: AlignEdge): ArrangeAxis {
  return edge === "left" || edge === "centerX" || edge === "right" ? "x" : "y";
}

/**
 * Where each box goes to put its own edge on that edge of the whole
 * selection's box.
 *
 * The selection's box is the union of the boxes handed in, so the outermost
 * member on the chosen side never moves and the others come to it. A centre
 * action puts every box's middle on the union's middle for that axis, which
 * is the only one of the six where every member can move.
 */
export function alignMoves(
  boxes: ReadonlyMap<string, WorldBounds>,
  edge: AlignEdge,
): ArrangeMoves {
  const moves = new Map<string, LevelPoint>();
  const union = unionBounds(boxes.values());
  if (!union) return moves;
  for (const [id, box] of boxes) {
    const shift = shiftTo(box, union, edge);
    moves.set(
      id,
      edgeAxis(edge) === "x" ? { x: shift, y: 0 } : { x: 0, y: shift },
    );
  }
  return moves;
}

/**
 * Where each box goes to leave an equal gap between every pair of neighbours
 * along `axis`.
 *
 * Gaps between boxes, not distances between centres: boxes of unequal size
 * spaced by their centres leave visibly different gaps, which is the thing
 * anyone reaching for this is trying to fix. The two outermost members stay
 * where they are, so the arrangement keeps the extent it had and only what is
 * between them moves.
 *
 * Fewer than three members have no gap to equalize — with two, whatever they
 * have is already the only gap — so nothing moves. Members that overlap end up
 * with an equal negative gap, which is the same rule and looks like an evenly
 * stacked deck.
 */
export function distributeMoves(
  boxes: ReadonlyMap<string, WorldBounds>,
  axis: ArrangeAxis,
): ArrangeMoves {
  const moves = new Map<string, LevelPoint>();
  if (boxes.size < 3) return moves;
  const order = [...boxes].sort(
    ([, a], [, b]) => leading(a, axis) - leading(b, axis),
  );
  const first = order[0]?.[1];
  const last = order[order.length - 1]?.[1];
  if (!first || !last) return moves;

  const span = trailing(last, axis) - leading(first, axis);
  let filled = 0;
  for (const [, box] of order) filled += extent(box, axis);
  const gap = (span - filled) / (order.length - 1);

  let at = leading(first, axis);
  for (const [index, entry] of order.entries()) {
    const [id, box] = entry;
    // The outermost two define the span the rest are spread inside, so they
    // stay put by the rule rather than by arithmetic: a running total of
    // floating-point gaps lands the last one a rounding away from where it
    // already is, and a rounding is a command, an undo step, and a number in
    // the file.
    const stays = index === 0 || index === order.length - 1;
    const shift = stays ? 0 : at - leading(box, axis);
    moves.set(id, axis === "x" ? { x: shift, y: 0 } : { x: 0, y: shift });
    at += extent(box, axis) + gap;
  }
  return moves;
}

/** How far along one axis a box moves to meet that edge of the union. */
function shiftTo(
  box: WorldBounds,
  union: WorldBounds,
  edge: AlignEdge,
): number {
  switch (edge) {
    case "left":
      return union.minX - box.minX;
    case "right":
      return union.maxX - box.maxX;
    case "centerX":
      return (union.minX + union.maxX - box.minX - box.maxX) / 2;
    case "top":
      return union.minY - box.minY;
    case "bottom":
      return union.maxY - box.maxY;
    case "centerY":
      return (union.minY + union.maxY - box.minY - box.maxY) / 2;
  }
}

function leading(box: WorldBounds, axis: ArrangeAxis): number {
  return axis === "x" ? box.minX : box.minY;
}

function trailing(box: WorldBounds, axis: ArrangeAxis): number {
  return axis === "x" ? box.maxX : box.maxY;
}

function extent(box: WorldBounds, axis: ArrangeAxis): number {
  return trailing(box, axis) - leading(box, axis);
}
