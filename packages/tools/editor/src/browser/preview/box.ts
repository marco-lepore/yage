import { Transform, type Entity } from "@yagejs/core";
import {
  BOX_GRIPS,
  gripOf,
  type BoxGrip,
  type WorldBounds,
} from "../commands/index.js";
import type {
  EditorPoint,
  GizmoAnchor,
  GizmoReference,
  HandleId,
} from "../store/index.js";
import { localBoxOf } from "./bounds.js";
import { GRAB_PIXELS, HANDLE_PIXELS, MISS_PIXELS } from "./gizmo.js";

/**
 * A placement's own rectangle, in world space.
 *
 * Held as a centre, two unit axes, and a half-extent along each rather than as
 * two corners, because the rectangle turns with the placement. An axis-aligned
 * rectangle drawn around a turned sprite has corners that are not on the
 * sprite, and scaling from one of those would not follow what is on screen.
 */
export interface OrientedBox {
  readonly center: EditorPoint;
  readonly axisX: EditorPoint;
  readonly axisY: EditorPoint;
  readonly halfX: number;
  readonly halfY: number;
}

/**
 * The smallest the box is allowed to be on screen, in screen pixels.
 *
 * At this size the handles along one edge are 24 pixels apart, so the nearer
 * one wins from 12 away — the tolerance {@link GRAB_PIXELS} promises — and the
 * middle of the box is 24 from the nearest handle, which leaves the interior
 * grabbable for a move. A placement smaller than this on screen is drawn with
 * a box larger than itself; the alternative is hiding the handles, which takes
 * scale and rotate away exactly when a dense level makes them fiddliest.
 */
export const MIN_BOX_PIXELS = 48;

/**
 * How far outside the box a press still turns the placement.
 *
 * Wide, and deliberately so. A handle sits on the box's edge and its own grab
 * region reaches {@link GRAB_PIXELS} plus half a dot outward, so a narrow band
 * is swallowed by the handles: at 24 the strip of band directly outside an
 * edge handle is six pixels, and on a placement small enough to be drawn at
 * {@link MIN_BOX_PIXELS} the handles are close enough together that no part of
 * the band is wider than eleven. Turning was a six-pixel target on a small
 * placement, which is the defect this whole design exists to avoid.
 *
 * At 40 the strip outside a handle is 22 pixels. The cost is that a press
 * within 40 pixels of a selected placement turns it rather than panning the
 * view; panning is still reachable from anywhere with space-drag and
 * middle-drag.
 */
export const TURN_BAND_PIXELS = 40;

/**
 * How far outside the band a press still counts as a missed grab, so the
 * selection survives it. The band is what the developer is aiming at, and this
 * is the same overshoot past a target that {@link MISS_PIXELS} allows past
 * {@link GRAB_PIXELS}.
 */
export const BAND_MISS_PIXELS = TURN_BAND_PIXELS + (MISS_PIXELS - GRAB_PIXELS);

/** The drawn radius of a box handle, which is nowhere to grab from. */
const HANDLE_RADIUS = HANDLE_PIXELS / 2;

/** One handle's id and where it sits in the world. */
export interface BoxHandle {
  readonly id: HandleId;
  readonly at: EditorPoint;
}

/** Where each of a box's grips sits in the world, in order round the box. */
export function boxHandles(
  box: OrientedBox,
  grips: Iterable<HandleId>,
): readonly BoxHandle[] {
  const shown = new Set(grips);
  return BOX_GRIPS.filter(([id]) => shown.has(id)).map(([id, grip]) => ({
    id,
    at: cornerAt(box, grip),
  }));
}

/** Where one grip's handle sits in the world. */
export function cornerAt(box: OrientedBox, grip: BoxGrip): EditorPoint {
  return {
    x:
      box.center.x +
      box.axisX.x * box.halfX * grip.x +
      box.axisY.x * box.halfY * grip.y,
    y:
      box.center.y +
      box.axisX.y * box.halfX * grip.x +
      box.axisY.y * box.halfY * grip.y,
  };
}

/**
 * The smallest box at `rotation` that covers every one of `parts`, or
 * `undefined` when there are none.
 *
 * Each part's four corners are projected onto the axes at `rotation` and the
 * extremes kept, so a selection of turned placements gets a box that holds
 * them rather than one drawn around their upright bounds. The corners
 * themselves are used, not each part's own axis-aligned rectangle, because a
 * turned rectangle's upright bounds are larger than the rectangle.
 */
export function coveringBox(
  parts: readonly OrientedBox[],
  rotation: number,
): OrientedBox | undefined {
  if (parts.length === 0) return undefined;
  const axisX = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const axisY = { x: -axisX.y, y: axisX.x };
  let least = { x: Infinity, y: Infinity };
  let most = { x: -Infinity, y: -Infinity };
  for (const part of parts) {
    for (const grip of CORNERS) {
      const at = cornerAt(part, grip);
      const along = { x: dot(at, axisX), y: dot(at, axisY) };
      least = { x: Math.min(least.x, along.x), y: Math.min(least.y, along.y) };
      most = { x: Math.max(most.x, along.x), y: Math.max(most.y, along.y) };
    }
  }
  const middle = { x: (least.x + most.x) / 2, y: (least.y + most.y) / 2 };
  return {
    center: {
      x: axisX.x * middle.x + axisY.x * middle.y,
      y: axisX.y * middle.x + axisY.y * middle.y,
    },
    axisX,
    axisY,
    halfX: (most.x - least.x) / 2,
    halfY: (most.y - least.y) / 2,
  };
}

function dot(a: EditorPoint, b: EditorPoint): number {
  return a.x * b.x + a.y * b.y;
}

/** The four corners of a box, as grips. */
const CORNERS: readonly BoxGrip[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

/**
 * The rectangle a placement that draws nothing is measured as: 32 by 32 of its
 * own units about its origin.
 *
 * A point has no size to divide by and contributes nothing to a box round a
 * selection, so every calculation that needs a rectangle would have to carry
 * its own answer for the placement that has none. This is that answer, in one
 * place.
 */
export const SUBSTITUTE_BOX: WorldBounds = {
  minX: -16,
  minY: -16,
  maxX: 16,
  maxY: 16,
};

/**
 * The placement's rectangle, grown so it is at least {@link MIN_BOX_PIXELS} on
 * screen along each of its own axes. Growth is symmetric about the centre, so
 * a handle stays on the side of the box it names.
 */
export function inflated(
  box: OrientedBox,
  perScreenPixel: number,
): OrientedBox {
  const least = (MIN_BOX_PIXELS / 2) * perScreenPixel;
  return {
    ...box,
    halfX: Math.max(box.halfX, least),
    halfY: Math.max(box.halfY, least),
  };
}

/**
 * Which part of the box a world point presses, or `null` for none.
 *
 * A handle first, by the same rule the arms use: nearest wins, measured from
 * the handle as drawn rather than from its centre. Then the interior, which
 * moves. Then the band outside, which turns.
 */
export function boxHandleAt(
  box: OrientedBox,
  grips: Iterable<HandleId>,
  perScreenPixel: number,
  point: EditorPoint,
): HandleId | null {
  const nearest = nearestBoxHandle(box, grips, perScreenPixel, point);
  if (nearest && nearest.away <= GRAB_PIXELS) return nearest.id;
  const beyond = outsideBy(box, point) / perScreenPixel;
  if (beyond === 0) return "body";
  return beyond <= TURN_BAND_PIXELS ? "turn" : null;
}

/**
 * Where a placement's own rectangle puts each side of its box when its own
 * scale is one, measured from the anchor along the anchor's axes.
 *
 * The pair is what a box handle over a single placement divides by. It is a
 * property of the artwork and the frame above the placement rather than a
 * measured screen distance, so multiplying it by a scale gives that side's
 * position for any scale, zero and mirrored included.
 */
export interface UnscaledSides {
  /** The side at the lower coordinate on each of the box's axes. */
  readonly least: EditorPoint;
  /** The side at the higher coordinate. */
  readonly most: EditorPoint;
}

/**
 * What each of the box's grips measures against, and by that the grips the
 * gizmo shows: a grip this leaves out is neither drawn nor grabbable.
 *
 * A grip is left out when the side it holds sits on the anchor on an axis it
 * acts on. That side is on the point the scale turns about, and scaling about
 * a point cannot move something sitting on it — the grip would be a handle
 * that does nothing however far it is dragged. It is the same test as the
 * division, so the two cannot disagree.
 *
 * `sides` is present only for a box over one placement scaling about its own
 * origin, where a drag sets the scale outright. Without it the grips measure
 * against the box as drawn, and a drag changes the frame's size by a fraction
 * of itself, which is what keeps a selection's arrangement.
 */
export function boxReferences(
  box: OrientedBox,
  anchor: GizmoAnchor,
  sides: UnscaledSides | undefined,
): ReadonlyMap<HandleId, GizmoReference> {
  const kind = sides ? "extent" : "length";
  const references = new Map<HandleId, GizmoReference>();
  for (const [id, grip] of BOX_GRIPS) {
    const x = sideReference(box, anchor, sides, grip.x, "x");
    const y = sideReference(box, anchor, sides, grip.y, "y");
    if ((grip.x !== 0 && x === 0) || (grip.y !== 0 && y === 0)) continue;
    references.set(id, { x, y, kind });
  }
  return references;
}

/**
 * One side's offset from the anchor along one axis. A grip that leaves the
 * axis alone reports the box's middle there, which nothing divides by.
 */
function sideReference(
  box: OrientedBox,
  anchor: GizmoAnchor,
  sides: UnscaledSides | undefined,
  side: -1 | 0 | 1,
  which: "x" | "y",
): number {
  if (sides) {
    const least = sides.least[which];
    const most = sides.most[which];
    if (side < 0) return least;
    return side > 0 ? most : (least + most) / 2;
  }
  const axis = which === "x" ? box.axisX : box.axisY;
  const half = which === "x" ? box.halfX : box.halfY;
  const away = {
    x: box.center.x - anchor.position.x,
    y: box.center.y - anchor.position.y,
  };
  return away.x * axis.x + away.y * axis.y + half * side;
}

/**
 * The direction a box handle grows the placement along: from the middle of the
 * box out to the handle, as a unit vector.
 *
 * Taken from the geometry rather than from the handle's name, so it follows a
 * turned placement, and so a corner of a rectangle that is not square reports
 * the diagonal it actually has rather than 45 degrees. `undefined` for the
 * interior and the turn band, which hold no side.
 */
export function boxHandleDirection(
  box: OrientedBox,
  handle: HandleId,
): EditorPoint | undefined {
  const grip = gripOf(handle);
  if (!grip) return undefined;
  const at = cornerAt(box, grip);
  const away = { x: at.x - box.center.x, y: at.y - box.center.y };
  const length = Math.hypot(away.x, away.y);
  return { x: away.x / length, y: away.y / length };
}

/**
 * Whether a press is near enough to the box to read as a missed grab rather
 * than as a press on what is behind it.
 */
export function nearBox(
  box: OrientedBox,
  perScreenPixel: number,
  point: EditorPoint,
): boolean {
  return outsideBy(box, point) / perScreenPixel <= BAND_MISS_PIXELS;
}

/**
 * The nearest of the grips a box offers and how far it is, in screen pixels,
 * or `undefined` when it offers none.
 */
export function nearestBoxHandle(
  box: OrientedBox,
  grips: Iterable<HandleId>,
  perScreenPixel: number,
  point: EditorPoint,
): { readonly id: HandleId; readonly away: number } | undefined {
  return boxHandles(box, grips)
    .map((handle) => ({
      id: handle.id,
      away: Math.max(
        0,
        Math.hypot(point.x - handle.at.x, point.y - handle.at.y) /
          perScreenPixel -
          HANDLE_RADIUS,
      ),
    }))
    .reduce<{ readonly id: HandleId; readonly away: number } | undefined>(
      (best, one) => (best === undefined || one.away < best.away ? one : best),
      undefined,
    );
}

/**
 * How far a world point lies outside the box, in world units. Zero anywhere
 * inside it.
 */
export function outsideBy(box: OrientedBox, point: EditorPoint): number {
  const local = inBoxSpace(box, point);
  const past = {
    x: Math.max(0, Math.abs(local.x) - box.halfX),
    y: Math.max(0, Math.abs(local.y) - box.halfY),
  };
  return Math.hypot(past.x, past.y);
}

/** A world point as offsets along the box's own axes, from its centre. */
export function inBoxSpace(box: OrientedBox, point: EditorPoint): EditorPoint {
  const dx = point.x - box.center.x;
  const dy = point.y - box.center.y;
  return {
    x: dx * box.axisX.x + dy * box.axisX.y,
    y: dx * box.axisY.x + dy * box.axisY.y,
  };
}

/**
 * The box an entity's visuals cover, in world space, or `undefined` when it
 * draws nothing.
 *
 * The rectangle comes from the placement's own space and is carried out
 * through its world transform, so it turns and stretches with the placement.
 * A negative scale mirrors the placement without moving the rectangle it
 * covers, so the extents take the magnitude.
 */
export function orientedBoxOf(entity: Entity): OrientedBox | undefined {
  const local = localBoxOf(entity);
  // A rectangle with no extent on either axis is a point, and a point has no
  // sides to put handles on. It is the same case the overlay marks with a
  // crosshair rather than an outline.
  if (!local || (local.maxX <= local.minX && local.maxY <= local.minY)) {
    return undefined;
  }
  return carriedBox(entity, local);
}

/**
 * The placement's own rectangle, or {@link SUBSTITUTE_BOX} carried out the same
 * way when it draws nothing. What a box round a selection measures its members
 * by, so a member with no picture still takes up room in it.
 */
export function boxAround(entity: Entity): OrientedBox {
  return orientedBoxOf(entity) ?? carriedBox(entity, SUBSTITUTE_BOX);
}

/** A rectangle in the placement's own space, carried out through its transform. */
function carriedBox(entity: Entity, local: WorldBounds): OrientedBox {
  const transform = entity.get(Transform);
  const position = transform.worldPosition;
  const scale = transform.worldScale;
  const rotation = transform.worldRotation;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const axisX = { x: cos, y: sin };
  const axisY = { x: -sin, y: cos };
  const middle = midpointOf(local);
  // The local rectangle's centre, taken out through the same scale, rotation,
  // and position the engine composes.
  const scaled = { x: middle.x * scale.x, y: middle.y * scale.y };
  return {
    center: {
      x: position.x + scaled.x * axisX.x + scaled.y * axisY.x,
      y: position.y + scaled.x * axisX.y + scaled.y * axisY.y,
    },
    axisX,
    axisY,
    halfX: ((local.maxX - local.minX) / 2) * Math.abs(scale.x),
    halfY: ((local.maxY - local.minY) / 2) * Math.abs(scale.y),
  };
}

function midpointOf(rect: WorldBounds): EditorPoint {
  return {
    x: (rect.minX + rect.maxX) / 2,
    y: (rect.minY + rect.maxY) / 2,
  };
}
