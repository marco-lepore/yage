import { axisOf, diagonalOf } from "../commands/index.js";
import type {
  EditorPoint,
  GizmoAnchor,
  GizmoMode,
  HandleId,
} from "../store/index.js";

/** One grabbable part of a gizmo, in world space. */
export interface GizmoHandle {
  readonly id: HandleId;
  readonly at: EditorPoint;
}

/** The nearest handle to a point, and how far away it is in screen pixels. */
export interface HandleReach {
  readonly id: HandleId;
  readonly away: number;
}

/**
 * Gizmo sizes in screen pixels — CSS pixels of pointer travel on the canvas.
 *
 * Screen pixels rather than world units so a gizmo stays one size while the
 * camera zooms, and rather than the renderer's virtual pixels so it also stays
 * one size when a fit scales the canvas. A canvas showing a 1280-wide virtual
 * viewport in a 760-wide pane draws a virtual pixel at 0.59 screen pixels, and
 * a target measured in virtual pixels shrinks with it.
 * {@link EditorPoint} arrives in world units, so every size here is multiplied
 * by `perScreenPixel` before it is compared against one.
 */
export const ARM_PIXELS = 64;
/** How wide the dot drawn at an arm's end and at the pivot is. */
export const HANDLE_PIXELS = 11;
export const RING_PIXELS = 46;
/**
 * How far outside a handle — outside the shape the overlay draws, not outside
 * its centre — a press still grabs it.
 *
 * Measuring from the drawn shape is what lets the arms and the centre handle
 * overlap without either losing its own area. Translate's arms begin under the
 * centre handle, so a press two pixels up and to the right of the pivot is
 * nearer to both arms than to the pivot itself while sitting squarely on the
 * dot the developer aimed at. Inside the dot the pivot is zero away and wins.
 */
export const GRAB_PIXELS = 12;
/**
 * How near a press must be to read as aimed at the gizmo and missed.
 *
 * A press this close to a handle keeps the selection instead of clearing it:
 * missing a handle by a few pixels means the developer wanted that handle, and
 * losing the gizmo is the one outcome they cannot have wanted.
 */
export const MISS_PIXELS = 24;
/** The drawn radius a handle's dot occupies, which is nowhere to grab from. */
const HANDLE_RADIUS = HANDLE_PIXELS / 2;
/** The marker drawn for a placement whose visuals have no size. */
export const CROSSHAIR_PIXELS = 10;
/**
 * How far along the diagonal the uniform-scale handle sits, in arm lengths.
 *
 * Off the pivot so it is somewhere of its own: both arms begin at the pivot,
 * and a handle sitting there would take every press meant for an arm's base.
 * Translate's centre handle does sit on the pivot, because free movement is
 * what a press there should mean when there is no arm to prefer.
 *
 * Nothing about the measurement depends on this — see {@link armLength}.
 */
export const UNIFORM_FRACTION = 0.6;

/**
 * Which handle a tie goes to.
 *
 * Both arms begin on the pivot, so a press there is exactly as near to each of
 * them and, in translate, to the centre handle as well. Free movement is what
 * a press on the pivot should mean.
 */
const TIE_ORDER: readonly HandleId[] = ["xy", "x", "y"];

/** Where a handle sits in {@link TIE_ORDER}. */
function rank(id: HandleId): number {
  return TIE_ORDER.indexOf(id);
}

/**
 * How far a gizmo arm reaches, in world units.
 *
 * Every scale gesture measures against this rather than against how far from
 * the pivot the press happened to land. Both arms start on the pivot, so a
 * press near their base would otherwise divide by nearly nothing.
 */
export function armLength(perScreenPixel: number): number {
  return ARM_PIXELS * perScreenPixel;
}

/**
 * The handles of a gizmo, in world space.
 *
 * `perScreenPixel` is world units per screen pixel — the reciprocal of the
 * camera's zoom, divided by how much the fit scales the canvas — and is what
 * converts the pixel sizes above into the space the handles are drawn and
 * hit-tested in.
 */
export function handlesFor(
  mode: GizmoMode,
  anchor: GizmoAnchor,
  perScreenPixel: number,
): readonly [GizmoHandle, ...GizmoHandle[]] {
  if (mode === "rotate") return [{ id: "ring", at: anchor.position }];
  const arm = ARM_PIXELS * perScreenPixel;
  return [
    { id: "x", at: offset(anchor, "x", arm) },
    { id: "y", at: offset(anchor, "y", arm) },
    { id: "xy", at: uniformHandleAt(mode, anchor, arm) },
  ];
}

/** Where the both-axes handle sits: on the pivot to move, off it to scale. */
function uniformHandleAt(
  mode: GizmoMode,
  anchor: GizmoAnchor,
  arm: number,
): EditorPoint {
  if (mode !== "scale") return anchor.position;
  const along = diagonalOf(anchor.rotation);
  return {
    x: anchor.position.x + along.x * arm * UNIFORM_FRACTION,
    y: anchor.position.y + along.y * arm * UNIFORM_FRACTION,
  };
}

/**
 * The handle a world point is nearest, and how far it is from it in screen
 * pixels.
 *
 * A whole arm counts, not only its tip, which is what the documented gesture
 * is. Nearest rather than first: the grab regions overlap where the arms meet
 * the pivot, and around the diagonal handle, and the developer means whichever
 * one they aimed closest to.
 */
export function nearestHandle(
  mode: GizmoMode,
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): HandleReach {
  if (mode === "rotate") {
    const ring = RING_PIXELS * perScreenPixel;
    const away = Math.abs(distance(point, anchor.position) - ring);
    return { id: "ring", away: away / perScreenPixel };
  }
  return handlesFor(mode, anchor, perScreenPixel)
    .map((handle) => ({
      id: handle.id,
      away: awayFrom(handle, anchor, perScreenPixel, point),
    }))
    .reduce((best, one) =>
      one.away < best.away ||
      (one.away === best.away && rank(one.id) < rank(best.id))
        ? one
        : best,
    );
}

/**
 * How far a press is from one handle as it is drawn, in screen pixels.
 *
 * The centre handle is a dot. An arm is a line out to its own dot, and counts
 * along its whole length, which is what the documented gesture is.
 */
function awayFrom(
  handle: GizmoHandle,
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): number {
  const toDot = distance(point, handle.at) / perScreenPixel - HANDLE_RADIUS;
  if (handle.id === "xy") return Math.max(0, toDot);
  const toArm = toSegment(point, anchor.position, handle.at) / perScreenPixel;
  return Math.max(0, Math.min(toArm, toDot));
}

/** Which handle a world point grabs, or `null` for none. */
export function handleAt(
  mode: GizmoMode,
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): HandleId | null {
  const near = nearestHandle(mode, anchor, perScreenPixel, point);
  return near.away <= GRAB_PIXELS ? near.id : null;
}

/**
 * The direction a handle scales the placement along, as a unit vector, or
 * `undefined` when the gesture has no direction to show.
 *
 * Only scale has one: a move goes wherever the pointer does, and a turn goes
 * round. The arms lie along the placement's own axes and the uniform handle
 * sits out on the diagonal, so each scales along where it is drawn.
 */
export function handleDirection(
  mode: GizmoMode,
  rotation: number,
  handle: HandleId,
): EditorPoint | undefined {
  if (mode !== "scale") return undefined;
  if (handle === "x" || handle === "y") return axisOf(rotation, handle);
  return diagonalOf(rotation);
}

/**
 * Whether a world point is near enough to the gizmo to read as a missed grab
 * rather than as a press on what is behind it.
 */
export function nearGizmo(
  mode: GizmoMode,
  anchor: GizmoAnchor,
  perScreenPixel: number,
  point: EditorPoint,
): boolean {
  return nearestHandle(mode, anchor, perScreenPixel, point).away <= MISS_PIXELS;
}

/** A point `reach` world units along one of the anchor's own axes. */
function offset(
  anchor: GizmoAnchor,
  which: "x" | "y",
  reach: number,
): EditorPoint {
  const axis = axisOf(anchor.rotation, which);
  return {
    x: anchor.position.x + axis.x * reach,
    y: anchor.position.y + axis.y * reach,
  };
}

function distance(a: EditorPoint, b: EditorPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** How far a point is from the line segment between `from` and `to`. */
function toSegment(
  point: EditorPoint,
  from: EditorPoint,
  to: EditorPoint,
): number {
  const runX = to.x - from.x;
  const runY = to.y - from.y;
  const length = runX * runX + runY * runY;
  if (length === 0) return distance(point, from);
  const along =
    ((point.x - from.x) * runX + (point.y - from.y) * runY) / length;
  const held = Math.min(1, Math.max(0, along));
  return distance(point, {
    x: from.x + runX * held,
    y: from.y + runY * held,
  });
}
