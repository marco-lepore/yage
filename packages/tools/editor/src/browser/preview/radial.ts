import type { EditorPoint, GizmoAnchor, HandleId } from "../store/index.js";
import { BAND_MISS_PIXELS, TURN_BAND_PIXELS } from "./box.js";
import { ARM_PIXELS, GRAB_PIXELS, nearestHandle } from "./gizmo.js";

/**
 * How far out the radial gizmo's boundary sits, in screen pixels.
 *
 * The arms end on it, so it is the circle the scale grips are arranged round —
 * the part the box gizmo's outline plays. Inside it a press moves the
 * placement; the band outside turns it.
 */
export const RADIAL_EDGE_PIXELS = ARM_PIXELS;

/**
 * The disc at the centre that always moves the placement, in screen pixels.
 *
 * Both arms begin on the origin and their whole length is grabbable, so
 * without this the point the developer is most likely to press belongs to a
 * scale arm and the gizmo has no move target at all where its subject is. It
 * stops short of the uniform grip's own reach — that grip sits six tenths of
 * an arm out and grabs from {@link GRAB_PIXELS} plus half a dot inside itself,
 * which is 21 pixels from the centre — so the disc takes nothing from it.
 */
export const RADIAL_BODY_PIXELS = 20;

/**
 * Which part of the radial gizmo a world point presses, or `null` for none.
 *
 * The gizmo a placement with no rectangle gets, and it carries all three
 * transforms the way the box gizmo does: press inside to move, a grip to
 * scale, just outside to turn. A grip is tested before the interior, except
 * over the centre disc, which is the one press that must always mean a move.
 */
export function radialHandleAt(
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): HandleId | null {
  const away = awayFrom(anchor, perScreenPixel, point);
  if (away > RADIAL_BODY_PIXELS) {
    const near = nearestHandle("scale", anchor, perScreenPixel, point);
    if (near.away <= GRAB_PIXELS) return near.id;
  }
  if (away <= RADIAL_EDGE_PIXELS) return "body";
  return away <= RADIAL_EDGE_PIXELS + TURN_BAND_PIXELS ? "turn" : null;
}

/**
 * Whether a press is near enough to the radial gizmo to read as a missed grab
 * rather than as a press on what is behind it. The band is what the developer
 * is aiming at, and this is the same overshoot past it that a press near the
 * box gizmo is allowed past the box's own band.
 */
export function nearRadial(
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): boolean {
  return (
    awayFrom(anchor, perScreenPixel, point) <=
    RADIAL_EDGE_PIXELS + BAND_MISS_PIXELS
  );
}

/** How far a world point is from the gizmo's centre, in screen pixels. */
function awayFrom(
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): number {
  return (
    Math.hypot(point.x - anchor.position.x, point.y - anchor.position.y) /
    perScreenPixel
  );
}
