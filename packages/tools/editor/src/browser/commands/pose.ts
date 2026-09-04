import type { PoseEdit } from "../../shared/commands/index.js";
import {
  snappedAngle,
  snappedPoint,
  type EditGesture,
  type EditorPoint,
  type EditorState,
  type GizmoAnchor,
  type GizmoMode,
  type GizmoReference,
  type HandleId,
  type ParamDrag,
  type PoseComponent,
} from "../store/index.js";
import { placementById } from "./graph.js";
import type {
  JsonObject,
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelPoint,
  LevelTransform,
} from "@yagejs/level/document";

/** The composed world rotation and scale of a placement's parent chain. */
export interface ParentFrame {
  readonly rotation: number;
  readonly scale: LevelPoint;
}

const IDENTITY: ParentFrame = { rotation: 0, scale: { x: 1, y: 1 } };

/** The transform a placement with no parent is relative to. */
export const WORLD_ORIGIN: LevelTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};

/**
 * What the engine's `Transform` composes onto a child, derived from the
 * document instead of from live entities: rotations add and scales multiply
 * up the parent chain (`packages/core/src/Transform.ts:167`). The editor has
 * to compute it the same way, or a dragged child lands somewhere other than
 * where the pointer left it.
 */
export function parentFrame(
  document: LevelDocument,
  placementId: string,
): ParentFrame {
  const parentId = placementById(document).get(placementId)?.parent;
  const world = parentWorld(document, parentId);
  return world.rotation === 0 && world.scale.x === 1 && world.scale.y === 1
    ? IDENTITY
    : { rotation: world.rotation, scale: world.scale };
}

/**
 * The world transform of the placement a child would be relative to: the
 * composed chain above `parentId`, or the origin when there is no parent.
 *
 * A parent the document does not hold, or a chain that loops, is treated as
 * the point the walk stopped at; the document layer refuses both, so neither
 * reaches a document the store holds.
 */
export function parentWorld(
  document: LevelDocument,
  parentId: string | undefined,
): LevelTransform {
  const byId = placementById(document);
  // Root first, so each level composes onto the world above it.
  const chain: LevelTransform[] = [];
  const seen = new Set<string>();
  let current = parentId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    chain.unshift(parent.transform);
    current = parent.parent;
  }
  let world = WORLD_ORIGIN;
  for (const local of chain) world = toWorld(local, world);
  return world;
}

/**
 * A local transform expressed in world space, given the world transform of
 * what it is relative to. Mirrors `Transform._recompute`: scale the local
 * position by the parent's world scale, rotate it by the parent's world
 * rotation, add the parent's world position; rotations add; scales multiply.
 */
export function toWorld(
  local: LevelTransform,
  parent: LevelTransform,
): LevelTransform {
  const scaled = {
    x: local.position.x * parent.scale.x,
    y: local.position.y * parent.scale.y,
  };
  const rotated = rotate(scaled, parent.rotation);
  return {
    position: {
      x: parent.position.x + rotated.x,
      y: parent.position.y + rotated.y,
    },
    rotation: parent.rotation + local.rotation,
    scale: {
      x: parent.scale.x * local.scale.x,
      y: parent.scale.y * local.scale.y,
    },
  };
}

/**
 * A world transform expressed relative to a parent's world transform — the
 * inverse of {@link toWorld}, and what `Transform`'s world setters do.
 *
 * A parent scaled to zero on an axis flattens everything under it onto its own
 * origin, so no world position or scale on that axis names one local value:
 * every local value produces the same world one. `keep` is the transform whose
 * components the answer takes there — the pose the caller already had, so a
 * placement under a flattened parent keeps the numbers it was authored with
 * instead of gaining an infinity the file cannot hold.
 */
export function toLocal(
  world: LevelTransform,
  parent: LevelTransform,
  keep: LevelTransform,
): LevelTransform {
  const offset = {
    x: world.position.x - parent.position.x,
    y: world.position.y - parent.position.y,
  };
  const rotated = rotate(offset, -parent.rotation);
  return {
    position: {
      x: parent.scale.x === 0 ? keep.position.x : rotated.x / parent.scale.x,
      y: parent.scale.y === 0 ? keep.position.y : rotated.y / parent.scale.y,
    },
    rotation: world.rotation - parent.rotation,
    scale: {
      x: parent.scale.x === 0 ? keep.scale.x : world.scale.x / parent.scale.x,
      y: parent.scale.y === 0 ? keep.scale.y : world.scale.y / parent.scale.y,
    },
  };
}

/** A placement's own world transform, composed from the document. */
export function placementWorld(
  document: LevelDocument,
  placement: LevelPlacement,
): LevelTransform {
  return toWorld(placement.transform, parentWorld(document, placement.parent));
}

/**
 * A point in a frame's own space, expressed in world space — {@link toWorld}
 * for a bare point, which has no rotation or scale of its own to compose.
 */
export function pointToWorld(
  local: LevelPoint,
  frame: LevelTransform,
): LevelPoint {
  const rotated = rotate(
    { x: local.x * frame.scale.x, y: local.y * frame.scale.y },
    frame.rotation,
  );
  return {
    x: frame.position.x + rotated.x,
    y: frame.position.y + rotated.y,
  };
}

/**
 * A world-space drag distance expressed in the placement's own local space,
 * which is what its transform stores. Mirrors `Transform`'s world-position
 * setter: undo the parent's rotation, then its scale.
 *
 * A parent flattened to zero on an axis draws every local position at the same
 * world point, so no local distance covers a world one: the answer there is a
 * move of nothing, which is what the placement does on screen.
 */
export function worldDeltaToLocal(
  frame: ParentFrame,
  delta: LevelPoint,
): LevelPoint {
  const rotated = rotate(delta, -frame.rotation);
  return {
    x: frame.scale.x === 0 ? 0 : rotated.x / frame.scale.x,
    y: frame.scale.y === 0 ? 0 : rotated.y / frame.scale.y,
  };
}

/**
 * The transform turned by an angle. Position and scale are untouched.
 *
 * The angle needs no conversion out of world space: the engine composes a
 * child's world rotation by adding the chain's, so a world delta is the local
 * delta whatever the parents do — including a mirrored one, because the model
 * adds the angle without regard to the sign of the scale.
 */
export function rotatedBy(
  transform: LevelTransform,
  radians: number,
): LevelTransform {
  return { ...transform, rotation: transform.rotation + radians };
}

/**
 * A world transform turned about a point.
 *
 * The placement orbits the pivot and turns by the same angle, so an
 * arrangement keeps its shape. When the pivot is the placement's own origin
 * this is {@link rotatedBy} with a longer way round to the same answer, which
 * is why the caller takes that path instead of passing the origin here.
 */
export function orbited(
  world: LevelTransform,
  pivot: LevelPoint,
  radians: number,
): LevelTransform {
  const turned = rotate(
    { x: world.position.x - pivot.x, y: world.position.y - pivot.y },
    radians,
  );
  return {
    position: { x: pivot.x + turned.x, y: pivot.y + turned.y },
    rotation: world.rotation + radians,
    scale: world.scale,
  };
}

/**
 * A world transform scaled about a point, measured along the axes at
 * `axisRotation`.
 *
 * The distance from the pivot stretches in that frame, which is what makes an
 * arrangement spread; the placement's own scale takes the same factor.
 *
 * One factor for everyone, and that is what keeps an arrangement's shape:
 * spreading the members by one number and sizing each by its own would move
 * the spacing and the members by different amounts.
 *
 * A scale of exactly zero is the one value that factor cannot leave. On an axis
 * sitting there a growing drag adds: the axis takes the reach as its new scale,
 * which is what {@link nextScale} gives a drawn length. Every other scale
 * multiplies, mirrored and below one included, because the shared factor is
 * what holds an arrangement's shape together.
 *
 * A shrinking drag leaves zero where it is. Adding a negative reach would put a
 * member that was resting at nothing on screen at half size and mirrored, in
 * answer to a gesture asking for less.
 *
 * **The two agree exactly only when the placement lies along those axes.** A
 * level transform holds a position, an angle, and a scale per axis — there is
 * no shear in it — so scaling a turned placement unevenly along someone else's
 * axes is not a transform this format can hold. The factor is applied to the
 * placement's own axes instead, which is exact whenever the two frames agree
 * and whenever the scale is uniform, and is the nearest representable answer
 * otherwise.
 */
export function dilated(
  world: LevelTransform,
  pivot: LevelPoint,
  reach: LevelPoint,
  axisRotation: number,
): LevelTransform {
  // A gesture that has not moved must not become an edit, for the reason
  // `scaledTo` gives.
  if (reach.x === 0 && reach.y === 0) return world;
  const factor = { x: 1 + reach.x, y: 1 + reach.y };
  const along = rotate(
    { x: world.position.x - pivot.x, y: world.position.y - pivot.y },
    -axisRotation,
  );
  const spread = rotate(
    { x: along.x * factor.x, y: along.y * factor.y },
    axisRotation,
  );
  return {
    position: { x: pivot.x + spread.x, y: pivot.y + spread.y },
    rotation: world.rotation,
    scale: {
      x: grown(world.scale.x, reach.x, factor.x),
      y: grown(world.scale.y, reach.y, factor.y),
    },
  };
}

/** One axis of {@link dilated}'s scale: additive at zero, multiplied elsewhere. */
function grown(base: number, reach: number, factor: number): number {
  if (base === 0 && reach > 0) return nextScale(base, reach, "length");
  return base * factor;
}

/**
 * The scale one axis reaches, from what it started at and how far the drag
 * moved as a fraction of what it measured against.
 *
 * An `extent` reference is the dragged side's own offset from the anchor at a
 * scale of one, so the fraction *is* the change in scale: the side lands where
 * the pointer left it whatever the scale was, a placement at zero has a side to
 * set, and a drag far enough back crosses zero into a mirror.
 *
 * A `length` reference is a drawn distance — an arm's own length, or the box
 * round a selection — which says nothing about the placement's size. A whole
 * reference of travel is a doubling for a placement at or above one, which is
 * what an arm has always done, and a whole unit for anything smaller, which is
 * what lets one at zero be brought back. The magnitude is what grows, so a
 * mirrored placement grows the way an unmirrored one does.
 */
export function nextScale(
  base: number,
  reach: number,
  reference: GizmoReference["kind"],
): number {
  if (reach === 0) return base;
  if (reference === "extent") return base + reach;
  const sign = base < 0 ? -1 : 1;
  return sign * (Math.abs(base) + reach * Math.max(Math.abs(base), 1));
}

/**
 * The transform with the scale a drag reached on each axis. Position and
 * rotation are untouched.
 *
 * Scales multiply up the chain, so a change measured in world space is the
 * change to make locally.
 *
 * A gesture that has not moved leaves the transform alone. Without that, a
 * press and release that changed nothing would rewrite the placement's pose
 * and take an undo step for it.
 */
export function scaledTo(
  transform: LevelTransform,
  reach: LevelPoint,
  reference: GizmoReference["kind"],
): LevelTransform {
  if (reach.x === 0 && reach.y === 0) return transform;
  return {
    ...transform,
    scale: {
      x: nextScale(transform.scale.x, reach.x, reference),
      y: nextScale(transform.scale.y, reach.y, reference),
    },
  };
}

/** The unit vector pointing at an angle. */
export function unitAt(radians: number): LevelPoint {
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/**
 * The unit vector along one of a transform's own axes, given its world
 * rotation. `y` is a quarter turn from `x`.
 */
export function axisOf(rotation: number, which: "x" | "y"): LevelPoint {
  return unitAt(rotation + (which === "y" ? Math.PI / 2 : 0));
}

/**
 * The direction the uniform-scale handle measures along: halfway between the
 * two axes. Both the module that draws the handle and the one that reads the
 * gesture derive it from the rotation, so they cannot disagree.
 */
export function diagonalOf(rotation: number): LevelPoint {
  return unitAt(rotation + Math.PI / 4);
}

/**
 * The angle from `from` to `to`, taken the short way round.
 *
 * `atan2` answers in `(-pi, pi]`, so subtracting two of its results jumps by a
 * full turn the moment the pointer crosses the ray opposite where it started.
 * Accumulating this per move instead keeps a rotation gesture continuous and
 * lets it pass a full turn.
 */
export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** The part of a world-space delta that lies along `axis`, a unit vector. */
export function alongAxis(delta: LevelPoint, axis: LevelPoint): LevelPoint {
  const reach = delta.x * axis.x + delta.y * axis.y;
  return { x: axis.x * reach, y: axis.y * reach };
}

/** The transform moved by a local-space offset. Rotation and scale are untouched. */
export function translated(
  transform: LevelTransform,
  offset: LevelPoint,
): LevelTransform {
  return {
    ...transform,
    position: {
      x: transform.position.x + offset.x,
      y: transform.position.y + offset.y,
    },
  };
}

function rotate(point: LevelPoint, radians: number): LevelPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/** Which side of a placement's box a handle holds on each axis. */
export interface BoxGrip {
  /** -1 for the side at lower `x`, 1 for the higher, 0 to leave the axis. */
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

/**
 * The box gizmo's eight handles, in order round the box, with the sides each
 * one holds.
 *
 * Compass names the box's own frame, not the screen's: `n` is the side at the
 * placement's lower `y`, which is the top of an unrotated placement and
 * somewhere else on a turned one.
 *
 * It lives here, with the rest of the pure transform maths, because both the
 * module that draws the handles and the one that turns a drag into a scale
 * read it. Written twice, a sign error between them would be invisible.
 */
export const BOX_GRIPS: readonly (readonly [HandleId, BoxGrip])[] = [
  ["nw", { x: -1, y: -1 }],
  ["n", { x: 0, y: -1 }],
  ["ne", { x: 1, y: -1 }],
  ["e", { x: 1, y: 0 }],
  ["se", { x: 1, y: 1 }],
  ["s", { x: 0, y: 1 }],
  ["sw", { x: -1, y: 1 }],
  ["w", { x: -1, y: 0 }],
];

/** Which sides a box handle holds, or `undefined` when it is not one. */
export function gripOf(id: HandleId): BoxGrip | undefined {
  return BOX_GRIPS.find(([handle]) => handle === id)?.[1];
}

/** Degrees in one radian, the conversion the transform panel works in. */
const DEGREES = 180 / Math.PI;

/**
 * One number of a local transform, in the unit a panel types it in: world
 * units for a position, degrees for the angle, a factor for a scale.
 *
 * The document stores the angle in radians, matching the engine's `Transform`,
 * and this pair is the one place that converts. Both the control bar's boxes and
 * the settle of a number one of them is stepping read it, so what the box
 * shows and what a command writes cannot disagree.
 */
export function poseNumber(
  transform: LevelTransform,
  component: PoseComponent,
): number {
  switch (component) {
    case "x":
      return transform.position.x;
    case "y":
      return transform.position.y;
    case "rotation":
      return transform.rotation * DEGREES;
    case "scaleX":
      return transform.scale.x;
    case "scaleY":
      return transform.scale.y;
  }
}

/** The transform with one of its numbers replaced. See {@link poseNumber}. */
export function withPoseNumber(
  transform: LevelTransform,
  component: PoseComponent,
  value: number,
): LevelTransform {
  switch (component) {
    case "x":
      return { ...transform, position: { ...transform.position, x: value } };
    case "y":
      return { ...transform, position: { ...transform.position, y: value } };
    case "rotation":
      return { ...transform, rotation: value / DEGREES };
    case "scaleX":
      return { ...transform, scale: { ...transform.scale, x: value } };
    case "scaleY":
      return { ...transform, scale: { ...transform.scale, y: value } };
  }
}

/**
 * Each dragged placement's transform, offset by the drag so far.
 *
 * Recomputed from the gesture on every read, so the preview, the command a
 * release sends, and the control bar's numbers during a drag are the same
 * arithmetic over the same inputs.
 *
 * The gesture is a parameter and not read from the state, because
 * `settleGesture` takes it out of the state before computing what to commit.
 */
export function gesturePoses(
  state: EditorState,
  gesture: EditGesture,
): readonly PoseEdit[] {
  const document = state.document;
  // Read at each move, like the modifiers: the toolbar switch and the
  // suspend key both take effect part-way through a drag.
  const lattice = latticeFor(state, gesture);
  const poses: PoseEdit[] = [];
  for (const id of gesture.ids) {
    const base = gesture.base.get(id);
    if (!base) continue;
    poses.push({ id, transform: posed(document, id, base, gesture, lattice) });
  }
  return poses;
}

/**
 * One placement's transform part-way through a gesture.
 *
 * About its own origin, rotate and scale touch neither the position nor the
 * parent's frame: the engine adds rotations and multiplies scales up the
 * chain, which makes a world delta the local delta.
 *
 * About a shared pivot they must move it — the placement orbits the pivot,
 * or its distance from it stretches — and a pivot is a point in world space,
 * so the pose goes out through the parent chain and back.
 *
 * A gesture that has not moved takes the own-origin path whatever the pivot
 * is. Under a turned or scaled parent the trip out to world space and back
 * does not return the exact numbers it left with, and `settleEdits` compares
 * poses exactly — so a press and release that never moved would otherwise
 * send a command, take an undo entry, and write a rounding into the file.
 */
function posed(
  document: LevelDocument,
  id: string,
  base: LevelTransform,
  gesture: Omit<EditGesture, "ids" | "base">,
  lattice: number | undefined,
): LevelTransform {
  const anchor = gesture.anchor;
  const pivot = gesture.pivot;
  if (gesture.kind === "rotate" && anchor) {
    const spin = turned(gesture);
    if (!pivot || spin === 0) return rotatedBy(base, spin);
    return about(document, id, base, (world) => orbited(world, pivot, spin));
  }
  if (gesture.kind === "scale" && anchor) {
    // What the handle's reference is worth at the press: the placement's own
    // scale when the reference is its unscaled artwork, and one when it is a
    // drawn length, whose frame starts out at its own size.
    const at =
      gesture.reference.kind === "extent" ? base.scale : { x: 1, y: 1 };
    const reached = stretched(anchor, gesture, at, lattice);
    if (!pivot || (reached.x === 0 && reached.y === 0)) {
      return scaledTo(base, reached, gesture.reference.kind);
    }
    return about(document, id, base, (world) =>
      dilated(world, pivot, reached, anchor.rotation),
    );
  }
  const raw = {
    x: gesture.current.x - gesture.origin.x,
    y: gesture.current.y - gesture.origin.y,
  };
  const axis = lockAxis(anchor, gesture, raw);
  const moved = axis ? alongAxis(raw, axis) : raw;
  return translated(
    base,
    worldDeltaToLocal(
      parentFrame(document, id),
      lattice === undefined
        ? moved
        : pulled(gesture.snapFrom.position, moved, lattice, axis),
    ),
  );
}

/** The lattice this gesture lands on, or nothing when it is free of the grid. */
function latticeFor(
  state: EditorState,
  gesture: { readonly suspended: boolean },
): number | undefined {
  return state.view.snap && !gesture.suspended ? state.view.step : undefined;
}

/**
 * A placement's pose after a change made in world space.
 *
 * The base is local, and a pivot is a world point, so the local pose is taken
 * out through the parent chain, changed, and brought back. The chain is read
 * from the document rather than from the gesture, which is safe because
 * `beginGesture` keeps only the outermost of a selection: nothing a gesture
 * moves is inside anything else it moves.
 */
function about(
  document: LevelDocument,
  id: string,
  base: LevelTransform,
  change: (world: LevelTransform) => LevelTransform,
): LevelTransform {
  const parent = parentWorld(document, placementById(document).get(id)?.parent);
  // The base is what an axis whose parent scale is zero keeps: under a
  // flattened parent every local pose draws at the parent's origin, so the
  // world pose names no one local value and the placement keeps the numbers it
  // was authored with.
  return toLocal(change(toWorld(base, parent)), parent, base);
}

/** The gesture's total turn once the pointer reaches `current`. */
export function spunTo(
  gesture: {
    readonly kind: GizmoMode;
    readonly anchor?: GizmoAnchor | undefined;
    readonly spin: number;
    readonly current: EditorPoint;
  },
  current: EditorPoint,
): number {
  const pivot = gesture.anchor?.position;
  if (gesture.kind !== "rotate" || !pivot) return gesture.spin;
  return (
    gesture.spin +
    shortestAngle(bearing(pivot, gesture.current), bearing(pivot, current))
  );
}

/** The direction from a pivot to a point, in radians. */
function bearing(pivot: EditorPoint, point: EditorPoint): number {
  return Math.atan2(point.y - pivot.y, point.x - pivot.x);
}

/**
 * How far the pointer has stretched each axis since the gesture began, as a
 * fraction of what that axis measures against, and zero for an axis the handle
 * leaves alone.
 *
 * The change is measured against the handle's own reference, not against how
 * far from the pivot the press landed. Both arms begin on the pivot and their
 * whole length is grabbable, so a ratio of distances would divide by a couple
 * of pixels for a press near the base and turn any drag into an enormous
 * number. Dragging one arm's length is one whole reference wherever the arm
 * was grabbed.
 *
 * An axis handle measures along that axis alone; the uniform handle measures
 * along the diagonal it sits on and applies the result to both. A box handle
 * measures along each axis it holds a side on.
 *
 * `at` is what the reference is worth at the press — the placement's own scale
 * when the reference is its unscaled artwork, and one when it is a drawn
 * length. The side the handle holds sits at `reference * at`, which is what
 * lets the lattice be applied here: the side is carried to where the pointer
 * put it, that point rounds to the nearest lattice point, and the fraction
 * becomes whatever puts the side there.
 *
 * The lattice lands a side, not a size. A step in a factor is arbitrary and
 * means nothing for a sprite that is not square, while a side on a grid line
 * makes a placement a whole number of cells across. Only a box grip holds a
 * side, so a Scale tool arm — which measures against its own drawn length, a
 * screen distance rather than part of the placement — is left where the
 * pointer put it. A side the lattice lands on the point the gesture scales
 * about is a scale of zero, and one behind it is a mirror; both are values
 * now, so both are kept.
 *
 * The rounding is along the placement's own axis, which is exact when that
 * axis lies along the world's and is the nearest side position a
 * `LevelTransform` can hold otherwise — the compromise {@link dilated}
 * records, for the same reason.
 */
function stretched(
  anchor: GizmoAnchor,
  gesture: {
    readonly handle?: HandleId | undefined;
    readonly reference: GizmoReference;
    readonly constrained: boolean;
    readonly origin: EditorPoint;
    readonly current: EditorPoint;
  },
  at: LevelPoint,
  step: number | undefined,
): LevelPoint {
  const grip = gesture.handle ? gripOf(gesture.handle) : undefined;
  const travelled = (axis: EditorPoint, against: number): number => {
    const moved =
      reach(anchor.position, gesture.current, axis) -
      reach(anchor.position, gesture.origin, axis);
    return moved / against;
  };
  const settled = (
    axis: EditorPoint,
    against: number,
    from: number,
    raw: number,
  ): number => {
    // A gesture that has not moved must not become an edit, for the reason
    // `scaledTo` gives: the correction alone would resize a placement that is
    // off the lattice on a press and release that changed nothing.
    if (step === undefined || !grip || raw === 0) return raw;
    const held = {
      x: anchor.position.x + axis.x * against * (from + raw),
      y: anchor.position.y + axis.y * against * (from + raw),
    };
    return (
      reach(anchor.position, snappedPoint(held, step), axis) / against - from
    );
  };
  const measure = (axis: EditorPoint, against: number, from: number): number =>
    settled(axis, against, from, travelled(axis, against));

  if (grip && gesture.constrained) {
    // Holding the modifier keeps the proportions, so both axes take one ratio
    // — including from an edge handle, which drives the pair from the one side
    // it holds.
    //
    // An axis at a scale of zero has no proportion to keep, so the artwork's
    // own is what the developer means: substituting one there measures the
    // corner against the rectangle at full size, and dragging it out by that
    // rectangle's half-diagonal reaches a scale of one on both axes. It changes
    // nothing anywhere else, because a length reference is worth one already.
    const held = { x: at.x === 0 ? 1 : at.x, y: at.y === 0 ? 1 : at.y };
    const along = towards(anchor, gesture.reference, held, grip);
    // The reference itself can still be degenerate, and no substitute recovers
    // a direction the gizmo does not have.
    if (along.against === 0) return { x: 0, y: 0 };
    const ratio = measure(along.axis, along.against, 1);
    return { x: held.x * ratio, y: held.y * ratio };
  }
  if (grip) {
    return {
      x:
        grip.x === 0
          ? 0
          : measure(axisOf(anchor.rotation, "x"), gesture.reference.x, at.x),
      y:
        grip.y === 0
          ? 0
          : measure(axisOf(anchor.rotation, "y"), gesture.reference.y, at.y),
    };
  }
  if (gesture.handle === "x")
    return {
      x: travelled(axisOf(anchor.rotation, "x"), gesture.reference.x),
      y: 0,
    };
  if (gesture.handle === "y")
    return {
      x: 0,
      y: travelled(axisOf(anchor.rotation, "y"), gesture.reference.y),
    };
  // The uniform handle measures along the diagonal it sits on, and applies
  // the result to both axes.
  const both = travelled(diagonalOf(anchor.rotation), gesture.reference.x);
  return { x: both, y: both };
}

/**
 * What a constrained box scale measures along, and against.
 *
 * A corner measures along the line from the pivot out to the corner itself, so
 * the corner keeps following the pointer while both axes hold their
 * proportions. An edge handle has no such line — it holds one side — so it
 * measures along its own axis, and the ratio that axis produces is applied to
 * both.
 *
 * The line is where the side sits at the press, which is the reference at what
 * the reference is worth then. `reference` carries the side each axis is on in
 * its sign, and that alone is what aims this outward — for a handle on the
 * box's lower side as much as its upper. The grip says which sides the handle
 * holds, not which way it faces, so it picks the axis here and takes no part
 * in the direction.
 *
 * A corner whose reference is zero on every axis it holds reports a distance of
 * zero: the gizmo has no line out to it, so there is no direction to measure
 * the drag along.
 */
function towards(
  anchor: GizmoAnchor,
  reference: GizmoReference,
  at: LevelPoint,
  grip: BoxGrip,
): { readonly axis: EditorPoint; readonly against: number } {
  const x = axisOf(anchor.rotation, "x");
  const y = axisOf(anchor.rotation, "y");
  const alongX = reference.x * at.x;
  const alongY = reference.y * at.y;
  if (grip.x === 0) return { axis: y, against: alongY };
  if (grip.y === 0) return { axis: x, against: alongX };
  const out = {
    x: x.x * alongX + y.x * alongY,
    y: x.y * alongX + y.y * alongY,
  };
  const length = Math.hypot(out.x, out.y);
  if (length === 0) return { axis: x, against: 0 };
  return { axis: { x: out.x / length, y: out.y / length }, against: length };
}

/**
 * The axis a move is held to, or nothing when it is free.
 *
 * Separate from applying it so the snap can see the axis: a snapped move that
 * is held to a line has to reach the point on that line nearest the lattice,
 * which needs the direction and not just the part of the delta along it.
 */
function lockAxis(
  anchor: GizmoAnchor | undefined,
  gesture: {
    readonly handle?: HandleId | undefined;
    readonly constrained: boolean;
  },
  delta: EditorPoint,
): LevelPoint | undefined {
  if (!anchor) return undefined;
  if (gesture.handle === "x" || gesture.handle === "y") {
    return axisOf(anchor.rotation, gesture.handle);
  }
  if (!gesture.constrained) return undefined;
  return nearestAxis(anchor.rotation, delta);
}

/**
 * Whichever of a frame's two axes a move has travelled furthest along.
 *
 * The choice follows the drag rather than being fixed when it started, so a
 * developer who takes the modifier up part-way through picks the axis they
 * have actually moved along.
 */
function nearestAxis(rotation: number, delta: EditorPoint): LevelPoint {
  const x = axisOf(rotation, "x");
  const y = axisOf(rotation, "y");
  const alongX = Math.abs(delta.x * x.x + delta.y * x.y);
  const alongY = Math.abs(delta.x * y.x + delta.y * y.y);
  return alongX >= alongY ? x : y;
}

/**
 * The move with the snap applied: one correction for the whole gesture, chosen
 * so `from` — the active placement's world origin at the press — lands on the
 * nearest lattice point.
 *
 * A held move keeps its axis. The correction is the part of the trip to that
 * lattice point that lies along the axis, so a move held to a world axis lands
 * exactly on the lattice in the coordinate the axis controls and leaves the
 * other where it was, and one held to a turned placement's own axis reaches
 * the point on that line nearest the lattice.
 */
export function pulled(
  from: EditorPoint,
  delta: EditorPoint,
  step: number,
  axis: LevelPoint | undefined,
): EditorPoint {
  // A gesture that has not moved must not become an edit, for the reason
  // `scaledTo` gives: the correction alone would move an off-grid placement on
  // a press and release that changed nothing.
  if (delta.x === 0 && delta.y === 0) return delta;
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  const target = snappedPoint(to, step);
  const full = { x: target.x - from.x, y: target.y - from.y };
  return axis ? alongAxis(full, axis) : full;
}

/**
 * A parameter value part-way through a drag of its handle.
 *
 * Recomputed from the drag on every read, the way {@link gesturePoses} is, so
 * the ring the overlay draws, the boxes the inspector shows, and the value a
 * release writes are the same arithmetic over the same inputs.
 *
 * The drag is a parameter rather than read from the state, because
 * `settleParamDrag` takes it out of the state before computing what to write.
 */
export function draggedValue(state: EditorState, drag: ParamDrag): JsonValue {
  switch (drag.kind) {
    case "point":
      return draggedPoint(state, drag);
  }
}

/**
 * Where a dragged point has reached, in the frame the value is stored in.
 *
 * The pointer's travel is applied to where the handle sat at the press, so the
 * handle stays under the pointer wherever on it the press landed. `Shift`
 * keeps the move to one axis of the value's own frame — the placement's when
 * the value is relative, the world's when it is not — and the lattice lands
 * the world point, which is the rule a dragged placement follows.
 */
function draggedPoint(state: EditorState, drag: ParamDrag): JsonValue {
  const document = state.document;
  const placement = placementById(document).get(drag.id);
  const frame = placement ? placementWorld(document, placement) : WORLD_ORIGIN;
  const raw = {
    x: drag.current.x - drag.origin.x,
    y: drag.current.y - drag.origin.y,
  };
  const axis = drag.constrained
    ? nearestAxis(drag.relative ? frame.rotation : 0, raw)
    : undefined;
  const moved = axis ? alongAxis(raw, axis) : raw;
  const lattice = latticeFor(state, drag);
  const settled =
    lattice === undefined ? moved : pulled(drag.from, moved, lattice, axis);
  if (!drag.relative) {
    return { x: drag.from.x + settled.x, y: drag.from.y + settled.y };
  }
  // The travel is applied to the authored numbers in their own frame rather
  // than the world point converted back: a press and release that moved
  // nothing then returns them bit for bit under any rotation, and an axis
  // whose frame is flattened keeps them, since every local value draws at the
  // frame's origin there and no world distance covers a local one.
  const keep =
    (placement ? authoredPoint(placement.params, drag.field) : undefined) ??
    ORIGIN;
  const local = worldDeltaToLocal(frame, settled);
  return { x: keep.x + local.x, y: keep.y + local.y };
}

const ORIGIN: LevelPoint = { x: 0, y: 0 };

/**
 * The point a parameter holds, or nothing when it holds something else — an
 * optional field emptied, or a value authored against a declaration that has
 * since changed.
 */
export function authoredPoint(
  params: JsonObject,
  field: string,
): LevelPoint | undefined {
  const value = Reflect.get(params, field) as unknown;
  if (typeof value !== "object" || value === null) return undefined;
  const x = Reflect.get(value, "x") as unknown;
  const y = Reflect.get(value, "y") as unknown;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  if (typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/** How large a step a stepped turn lands on. */
export const TURN_STEP = Math.PI / 12;

/**
 * The turn a gesture commits: rounded so the active placement's world angle
 * lands on a step for as long as the modifier is held.
 *
 * The rounding is absolute, so 45° means 45° rather than 45° on top of
 * whatever angle the placement already sat at.
 *
 * The lattice has no part in this. A lattice is a spacing in world units and
 * says nothing about angles, and a mode and a held key are not the same
 * promise: a mode is a state you forget you are in, and only a key can be
 * asked for once.
 */
function turned(gesture: {
  readonly spin: number;
  readonly constrained: boolean;
  readonly snapFrom: GizmoAnchor;
}): number {
  if (!gesture.constrained || gesture.spin === 0) return gesture.spin;
  const target = gesture.snapFrom.rotation + gesture.spin;
  return snappedAngle(target, TURN_STEP) - gesture.snapFrom.rotation;
}

/** What a gesture measures against when nothing set a reference. */
export const UNIT_REFERENCE: GizmoReference = { x: 1, y: 1, kind: "length" };

/** How far a point sits from a pivot along one direction, signed. */
function reach(
  pivot: EditorPoint,
  point: EditorPoint,
  axis: EditorPoint,
): number {
  return (point.x - pivot.x) * axis.x + (point.y - pivot.y) * axis.y;
}

/** Whether two transforms hold the same position, rotation, and scale. */
export function samePose(a: LevelTransform, b: LevelTransform): boolean {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.rotation === b.rotation &&
    a.scale.x === b.scale.x &&
    a.scale.y === b.scale.y
  );
}
