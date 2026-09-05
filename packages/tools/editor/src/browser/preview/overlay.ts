import type { WorldBounds } from "../commands/index.js";
import type {
  EditorPoint,
  GizmoAnchor,
  GizmoMode,
  HandleId,
} from "../store/index.js";
import {
  CROSSHAIR_PIXELS,
  HANDLE_PIXELS,
  RING_PIXELS,
  handlesFor,
} from "./gizmo.js";
import { boxHandles, cornerAt, inflated, type OrientedBox } from "./box.js";
import { MARK_PIXELS, type PlacedMark } from "./marks.js";
import { RADIAL_BODY_PIXELS, RADIAL_EDGE_PIXELS } from "./radial.js";

/**
 * The part of a Pixi `Graphics` the overlay draws through.
 *
 * It is declared here rather than imported so the drawing can be tested by
 * recording the calls, which is the only way to assert a picture without a
 * canvas. Every method a real `Graphics` returns `this` from is typed the same
 * way, so a real one satisfies this as it stands.
 */
export interface OverlayTarget {
  clear(): OverlayTarget;
  moveTo(x: number, y: number): OverlayTarget;
  lineTo(x: number, y: number): OverlayTarget;
  rect(x: number, y: number, width: number, height: number): OverlayTarget;
  circle(x: number, y: number, radius: number): OverlayTarget;
  stroke(style: {
    color: number;
    width: number;
    alpha?: number;
  }): OverlayTarget;
  fill(style: { color: number; alpha?: number }): OverlayTarget;
}

/** What the overlay should show this frame. */
export interface OverlayView {
  /** One rectangle per selected placement that covers any area. */
  readonly boxes: readonly WorldBounds[];
  /**
   * What a drag of the selection would take with it: every placement authored
   * under it that is not itself selected. Marked the same way and more
   * quietly, because a child can be drawn far outside its parent's box and
   * would otherwise move for no visible reason.
   */
  readonly carried?: OverlayMarks | undefined;
  /** The gizmo, when anything is selected and a tool draws one. */
  readonly gizmo?: OverlayGizmo | undefined;
  /**
   * One point per selected placement's origin, drawn as a crosshair.
   *
   * It is where a scale turns about, so it says why a box grip on a side
   * running through it is missing, and it is where a placement that draws
   * nothing sits — the row of component marks over it says what that
   * placement is made of.
   */
  readonly origins?: readonly EditorPoint[] | undefined;
  /**
   * One mark per component the preview draws nothing for, already laid out in
   * a row over the origin of the placement it belongs to.
   *
   * Drawn for every placement rather than only for the selection: a placement
   * whose only component is a light or a panel has nothing else on screen, so
   * without the marks there is nothing to aim at in order to select it.
   */
  readonly marks?: readonly PlacedMark[] | undefined;
  /**
   * One line per reference the selection is an end of: what it points at, and
   * what points at it.
   *
   * Drawn only around the selection, so at most a handful are ever on screen
   * and a level's references never crowd the picture.
   */
  readonly links?: readonly OverlayLink[] | undefined;
  /**
   * One handle per place-valued parameter of the selected placement.
   *
   * Drawn for the selection alone, the way the gizmo is: a level of twenty
   * slimes with patrol ends would otherwise be a level of twenty stray rings.
   */
  readonly handles?: readonly ParamHandle[] | undefined;
  /** The rectangle a marquee is dragging out, while one is being dragged. */
  readonly marquee?: WorldBounds | undefined;
  /**
   * World units per screen pixel. Every size below is a count of screen
   * pixels, so this is what puts them in the space the overlay draws in.
   */
  readonly perScreenPixel: number;
}

/** Placements to mark: a rectangle for each that covers area, a point for the rest. */
export interface OverlayMarks {
  readonly boxes: readonly WorldBounds[];
  readonly points: readonly EditorPoint[];
}

/** One reference, from the placement that holds it to the one it names. */
export interface OverlayLink {
  readonly from: EditorPoint;
  readonly to: EditorPoint;
}

/**
 * One parameter value a press can drag, drawn where the value is.
 *
 * A union by `kind` so a value needing more than one handle joins without
 * changing what a point handle is.
 */
export type ParamHandle = {
  readonly kind: "point";
  /** The placement holding the parameter. */
  readonly id: string;
  /** The parameter's name, which the viewport shows on hover. */
  readonly field: string;
  /** Where the handle sits in world space. */
  readonly at: EditorPoint;
  /**
   * The placement's own world origin, drawn as a dashed line back to the
   * handle. Present only for a value in the placement's own frame, where the
   * line is what says the value travels with the placement.
   */
  readonly from?: EditorPoint | undefined;
};

/**
 * What to draw over the selected placement: the handles for one transform, or
 * the placement's own box carrying all three.
 */
export type OverlayGizmo =
  | {
      readonly kind: "arms";
      readonly mode: GizmoMode;
      readonly anchor: GizmoAnchor;
      /**
       * The box round a whole selection, drawn without handles. It is what a
       * `center` pivot is the centre of; without it the anchor sits in the
       * middle of nothing.
       */
      readonly covering?: OrientedBox | undefined;
    }
  | {
      /**
       * The box gizmo's three transforms round a placement with no rectangle:
       * a disc that moves, arms that scale, and the band outside the boundary
       * circle that turns.
       */
      readonly kind: "radial";
      readonly anchor: GizmoAnchor;
      readonly covering?: OrientedBox | undefined;
    }
  | {
      readonly kind: "box";
      readonly box: OrientedBox;
      /** The grips this box offers; one it cannot move is not drawn. */
      readonly grips: readonly HandleId[];
      /**
       * The point rotate and scale turn about, which need not be the centre.
       * Absent under the `individual` pivot, where every placement turns about
       * its own origin and there is no one point to mark.
       */
      readonly pivot?: EditorPoint | undefined;
    };

const MARKER_COLOR = 0x38bdf8;
const AXIS_X_COLOR = 0xf87171;
const AXIS_Y_COLOR = 0x4ade80;
const CENTRE_COLOR = 0xfacc15;
const LINE_PIXELS = 2;
/**
 * The marker for a placement the selection carries: half the line and faded,
 * so the two read as one family with an obvious primary.
 */
const CARRIED_LINE_PIXELS = 1;
const CARRIED_ALPHA = 0.55;
/**
 * How strongly the box round a whole selection is drawn. Below the placements
 * inside it, because it is a summary of the selection rather than a member of
 * it, and above what the selection carries, which is not selected at all.
 */
const COVERING_ALPHA = 0.75;
/**
 * The dark edge drawn under every coloured stroke and around every handle.
 *
 * A project chooses the preview's background, so the overlay cannot assume a
 * dark one. Without the casing a red arm over red scenery is invisible.
 */
export const CASING_COLOR = 0x0b0e14;
const CASING_PIXELS = 2;
/**
 * A reference line's colour, which is none of the four above: it is neither a
 * selection nor an axis, and reading it as either would say the wrong thing
 * about what a drag would move.
 */
const LINK_COLOR = 0xc084fc;
const LINK_ALPHA = 0.9;
const LINK_LINE_PIXELS = 1.5;
/** How long one dash is, in screen pixels. */
export const LINK_DASH_PIXELS = 7;
/** How much space follows each dash, in screen pixels. */
const LINK_GAP_PIXELS = 5;
/** How far back from the target the arrowhead's two barbs reach. */
const LINK_HEAD_PIXELS = 10;
/** The angle each barb makes with the line, in radians. */
const LINK_HEAD_ANGLE = Math.PI / 6;
/**
 * A parameter handle's colour, which is none of the others: it is not a
 * selection, not an axis, and not a reference — reading it as any of those
 * would say the wrong thing about what a drag of it moves.
 */
const PARAM_COLOR = 0x34d399;
/** The radius of the ring drawn at a parameter's value, in screen pixels. */
export const PARAM_HANDLE_PIXELS = 7;
/** How far outside that ring a press still grabs it, in screen pixels. */
export const PARAM_GRAB_PIXELS = 8;
/** How long one dash of the line back to the origin is, in screen pixels. */
const PARAM_DASH_PIXELS = 5;
/** How much space follows each of those dashes, in screen pixels. */
const PARAM_GAP_PIXELS = 4;
/** How heavily a mark's drawing is stroked, in screen pixels. */
const MARK_LINE_PIXELS = 1.5;
/** How solid the plate behind a mark is, so the drawing reads over scenery. */
const MARK_PLATE_ALPHA = 0.8;

/**
 * Draw the selection marker and the gizmo.
 *
 * Every size is a screen-pixel count multiplied by `perScreenPixel`, so the
 * overlay keeps one size on screen however the camera is zoomed and however
 * much a fit scales the canvas. The whole picture is redrawn each frame rather
 * than moved, because both of those change what the sizes are.
 */
export function drawOverlay(target: OverlayTarget, view: OverlayView): void {
  target.clear();
  const line = LINE_PIXELS * view.perScreenPixel;
  const casing = (LINE_PIXELS + CASING_PIXELS) * view.perScreenPixel;
  const arm = CROSSHAIR_PIXELS * view.perScreenPixel;
  const selected: MarkerStyle = { line, casing, alpha: 1 };
  const carried: MarkerStyle = {
    line: CARRIED_LINE_PIXELS * view.perScreenPixel,
    casing: (CARRIED_LINE_PIXELS + CASING_PIXELS) * view.perScreenPixel,
    alpha: CARRIED_ALPHA,
  };

  // Under everything else: a line ends on two origins, and an origin is where
  // a gizmo handle, a crosshair and a row of marks all sit.
  for (const link of view.links ?? []) {
    drawLink(target, link, view.perScreenPixel);
  }

  // What the selection carries goes down first, so the selection sits on top
  // of it wherever a child overlaps its parent.
  for (const box of view.carried?.boxes ?? []) markBox(target, box, carried);
  for (const point of view.carried?.points ?? []) {
    markPoint(target, point, arm, carried);
  }

  for (const box of view.boxes) markBox(target, box, selected);

  const marquee = view.marquee;
  if (marquee) {
    const width = marquee.maxX - marquee.minX;
    const height = marquee.maxY - marquee.minY;
    target
      .rect(marquee.minX, marquee.minY, width, height)
      .fill({ color: MARKER_COLOR, alpha: 0.12 })
      .rect(marquee.minX, marquee.minY, width, height)
      .stroke({ color: CASING_COLOR, width: casing, alpha: 0.55 })
      .rect(marquee.minX, marquee.minY, width, height)
      .stroke({ color: MARKER_COLOR, width: line });
  }

  // A placement's origin is where a scale turns about and where a placement
  // that draws nothing is, so it is marked whatever else is on screen.
  for (const origin of view.origins ?? []) {
    markPoint(target, origin, arm, selected);
  }

  // Above the placements and their origins, because a mark is the only thing
  // on screen for the placement it belongs to and has to stay pressable when
  // scenery is drawn over that point.
  for (const mark of view.marks ?? []) {
    drawMark(target, mark, view.perScreenPixel);
  }

  const gizmo = view.gizmo;
  if (gizmo)
    drawGizmo(target, gizmo, view.perScreenPixel, line, casing, carried);

  // Above the marks and the gizmo, because a press tests a parameter handle
  // before either of them: a relative point at the placement's origin sits
  // under the translate gizmo's centre grip, and drawn below it would vanish.
  for (const handle of view.handles ?? []) {
    drawParamHandle(target, handle, view.perScreenPixel, casing);
  }
}

/** The selection's gizmo: a box, a radial, a ring, or the arms. */
function drawGizmo(
  target: OverlayTarget,
  gizmo: OverlayGizmo,
  perScreenPixel: number,
  line: number,
  casing: number,
  carried: MarkerStyle,
): void {
  if (gizmo.kind === "box") {
    drawBox(target, gizmo, perScreenPixel);
    return;
  }
  if (gizmo.covering) {
    // Lighter than the placements it encloses: it is a summary of what is
    // selected, not another thing selected.
    outlineBox(target, gizmo.covering, carried.line, carried.casing, {
      alpha: COVERING_ALPHA,
    });
  }
  if (gizmo.kind === "radial") {
    drawRadial(target, gizmo.anchor, perScreenPixel, line, casing);
    return;
  }
  if (gizmo.mode === "rotate") {
    const radius = RING_PIXELS * perScreenPixel;
    target
      .circle(gizmo.anchor.position.x, gizmo.anchor.position.y, radius)
      .stroke({ color: CASING_COLOR, width: casing, alpha: 0.55 })
      .circle(gizmo.anchor.position.x, gizmo.anchor.position.y, radius)
      .stroke({ color: CENTRE_COLOR, width: line });
    return;
  }

  drawArms(target, gizmo.mode, gizmo.anchor, perScreenPixel, line, casing);
}

/**
 * One parameter value: a ring where the value is, and a dashed line back to
 * the placement's origin when the value is measured from it.
 *
 * A ring rather than a filled dot, so it does not read as a gizmo handle; the
 * line says the value travels with the placement, and its absence says the
 * value is a world point that stays where it is when the placement moves.
 */
function drawParamHandle(
  target: OverlayTarget,
  handle: ParamHandle,
  perScreenPixel: number,
  casing: number,
): void {
  const from = handle.from;
  if (from) {
    dashedLine(target, from, handle.at, perScreenPixel, {
      color: PARAM_COLOR,
      width: LINK_LINE_PIXELS * perScreenPixel,
      alpha: LINK_ALPHA,
    });
  }
  const radius = PARAM_HANDLE_PIXELS * perScreenPixel;
  target
    .circle(handle.at.x, handle.at.y, radius)
    .stroke({ color: CASING_COLOR, width: casing, alpha: 0.55 })
    .circle(handle.at.x, handle.at.y, radius)
    .stroke({ color: PARAM_COLOR, width: LINE_PIXELS * perScreenPixel });
}

/**
 * Which parameter handle a world point grabs, or nothing.
 *
 * The nearest wins, and among handles the same distance away the
 * later-declared field does — so two values sitting on one point are told
 * apart the way two rows of the inspector are, by declaration order.
 */
export function paramHandleAt(
  handles: readonly ParamHandle[],
  perScreenPixel: number,
  point: EditorPoint,
): ParamHandle | undefined {
  const reach = PARAM_HANDLE_PIXELS + PARAM_GRAB_PIXELS;
  let grabbed: ParamHandle | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const handle of handles) {
    const away =
      Math.hypot(point.x - handle.at.x, point.y - handle.at.y) / perScreenPixel;
    if (away > reach || away > nearest) continue;
    grabbed = handle;
    nearest = away;
  }
  return grabbed;
}

/**
 * A line drawn in dash-plus-gap strides from `from` towards `to`. Both lengths
 * are counts of screen pixels, so a long line and a short one are drawn from
 * the same pattern at any zoom, and a span shorter than one dash draws that
 * span rather than nothing.
 */
function dashedLine(
  target: OverlayTarget,
  from: EditorPoint,
  to: EditorPoint,
  perScreenPixel: number,
  style: { color: number; width: number; alpha?: number },
  dashPixels: number = PARAM_DASH_PIXELS,
  gapPixels: number = PARAM_GAP_PIXELS,
): void {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (span === 0) return;
  const along = { x: (to.x - from.x) / span, y: (to.y - from.y) / span };
  const dash = dashPixels * perScreenPixel;
  const stride = dash + gapPixels * perScreenPixel;
  for (let start = 0; start < span; start += stride) {
    const end = Math.min(start + dash, span);
    target
      .moveTo(from.x + along.x * start, from.y + along.y * start)
      .lineTo(from.x + along.x * end, from.y + along.y * end)
      .stroke(style);
  }
}

/**
 * One reference: a dashed line from the placement holding it to the placement
 * it names, with an arrowhead at the target.
 *
 * Dashed rather than solid so it is not read as an edge of anything, and
 * headed because a reference runs one way and two placements can point at each
 * other. Both the dashes and the head are counts of screen pixels, so a long
 * line and a short one are drawn from the same pattern at any zoom.
 */
function drawLink(
  target: OverlayTarget,
  link: OverlayLink,
  perScreenPixel: number,
): void {
  const span = Math.hypot(link.to.x - link.from.x, link.to.y - link.from.y);
  // Two ends at one point have no direction, so there is no line to dash and
  // no way to aim a head.
  if (span === 0) return;
  const along = {
    x: (link.to.x - link.from.x) / span,
    y: (link.to.y - link.from.y) / span,
  };
  const style = {
    color: LINK_COLOR,
    width: LINK_LINE_PIXELS * perScreenPixel,
    alpha: LINK_ALPHA,
  };

  dashedLine(
    target,
    link.from,
    link.to,
    perScreenPixel,
    style,
    LINK_DASH_PIXELS,
    LINK_GAP_PIXELS,
  );

  const head = LINK_HEAD_PIXELS * perScreenPixel;
  for (const turn of [LINK_HEAD_ANGLE, -LINK_HEAD_ANGLE]) {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const back = { x: -along.x * head, y: -along.y * head };
    target
      .moveTo(link.to.x, link.to.y)
      .lineTo(
        link.to.x + back.x * cos - back.y * sin,
        link.to.y + back.x * sin + back.y * cos,
      )
      .stroke(style);
  }
}

/**
 * One mark: a plate, and a drawing standing for the kind of component.
 *
 * The drawing stands for the component rather than for what it will render.
 * A light has no size the editor can measure, an emitter's own extent changes
 * every frame, and a panel's is whatever its layout produced — so a mark says
 * that something is there and will appear on play, and nothing about how big.
 *
 * The plate is what makes it readable: a project chooses the preview's
 * background, and a mark is drawn over the level's own artwork as often as
 * over empty space.
 */
function drawMark(
  target: OverlayTarget,
  mark: PlacedMark,
  perScreenPixel: number,
): void {
  const half = (MARK_PIXELS / 2) * perScreenPixel;
  const line = MARK_LINE_PIXELS * perScreenPixel;
  const glyph = { color: MARKER_COLOR, width: line };
  const { x, y } = mark.at;
  target
    .rect(x - half, y - half, half * 2, half * 2)
    .fill({ color: CASING_COLOR, alpha: MARK_PLATE_ALPHA })
    .rect(x - half, y - half, half * 2, half * 2)
    .stroke({ color: MARKER_COLOR, width: line, alpha: 0.5 });

  switch (mark.kind) {
    // A panel: a frame with its top edge ruled off.
    case "ui": {
      const side = half * 0.5;
      target
        .rect(x - side, y - side, side * 2, side * 2)
        .stroke(glyph)
        .moveTo(x - side, y - side * 0.4)
        .lineTo(x + side, y - side * 0.4)
        .stroke(glyph);
      return;
    }
    // An emitter: a source, and what it has thrown off it.
    case "particles": {
      target.circle(x, y, half * 0.2).fill({ color: MARKER_COLOR });
      for (const corner of DIAGONALS) {
        target
          .circle(x + corner.x * half * 0.55, y + corner.y * half * 0.55, line)
          .fill({ color: MARKER_COLOR });
      }
      return;
    }
    // A light: a source with rays off it.
    case "light": {
      target.circle(x, y, half * 0.3).fill({ color: MARKER_COLOR });
      for (const axis of AXES) {
        target
          .moveTo(x + axis.x * half * 0.5, y + axis.y * half * 0.5)
          .lineTo(x + axis.x * half * 0.85, y + axis.y * half * 0.85)
          .stroke(glyph);
      }
      return;
    }
    // An occluder: a solid body, which is what it is to the light.
    case "occluder": {
      const side = half * 0.45;
      target
        .rect(x - side, y - side, side * 2, side * 2)
        .fill({ color: MARKER_COLOR });
      return;
    }
    // Anything else, named by its type string when the pointer rests on it.
    case "other": {
      target
        .circle(x, y, half * 0.5)
        .stroke(glyph)
        .circle(x, y, line)
        .fill({ color: MARKER_COLOR });
      return;
    }
  }
}

/** The four corner directions, for a mark's drawing. */
const DIAGONALS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

/** The four axis directions, for a mark's drawing. */
const AXES = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
] as const;

/** One gizmo's two axis arms and its both-axes handle. */
function drawArms(
  target: OverlayTarget,
  mode: GizmoMode,
  anchor: GizmoAnchor,
  perScreenPixel: number,
  line: number,
  casing: number,
): void {
  const radius = (HANDLE_PIXELS * perScreenPixel) / 2;
  // Translate points its arms with a round tip; scale squares them off, so
  // the two gizmos are told apart by shape rather than only by what moves.
  const round = mode !== "scale";
  const handle = (at: EditorPoint, color: number, circle: boolean): void => {
    if (circle) target.circle(at.x, at.y, radius);
    else target.rect(at.x - radius, at.y - radius, radius * 2, radius * 2);
    target.fill({ color }).stroke({ color: CASING_COLOR, width: casing / 2 });
  };

  for (const spot of handlesFor(mode, anchor, perScreenPixel)) {
    if (spot.id === "xy") {
      handle(spot.at, CENTRE_COLOR, false);
      continue;
    }
    const color = spot.id === "x" ? AXIS_X_COLOR : AXIS_Y_COLOR;
    target
      .moveTo(anchor.position.x, anchor.position.y)
      .lineTo(spot.at.x, spot.at.y)
      .stroke({ color: CASING_COLOR, width: casing, alpha: 0.55 })
      .moveTo(anchor.position.x, anchor.position.y)
      .lineTo(spot.at.x, spot.at.y)
      .stroke({ color, width: line });
    handle(spot.at, color, round);
  }
}

/**
 * The gizmo a placement with no rectangle gets: the box gizmo's three
 * transforms arranged round the origin instead of round a rectangle.
 *
 * The boundary circle plays the part the box outline plays: a press inside it
 * moves the placement and one in the band outside it turns. The scale arms end
 * on it. The disc at the centre is drawn as well, because both arms cross it
 * and nothing else would say that a press there is a move.
 */
function drawRadial(
  target: OverlayTarget,
  anchor: GizmoAnchor,
  perScreenPixel: number,
  line: number,
  casing: number,
): void {
  const edge = RADIAL_EDGE_PIXELS * perScreenPixel;
  const body = RADIAL_BODY_PIXELS * perScreenPixel;
  target
    .circle(anchor.position.x, anchor.position.y, edge)
    .stroke({ color: CASING_COLOR, width: casing, alpha: 0.55 })
    .circle(anchor.position.x, anchor.position.y, edge)
    .stroke({ color: MARKER_COLOR, width: line })
    .circle(anchor.position.x, anchor.position.y, body)
    .fill({ color: MARKER_COLOR, alpha: 0.18 })
    .circle(anchor.position.x, anchor.position.y, body)
    .stroke({ color: MARKER_COLOR, width: line, alpha: COVERING_ALPHA });
  drawArms(target, "scale", anchor, perScreenPixel, line, casing);
}

/**
 * The placement's own box: its outline, a handle on each side and corner, and
 * a marker at the point a turn or a scale works about.
 *
 * The outline follows the box's own axes, so a turned placement gets a turned
 * rectangle rather than an upright one drawn around it. The pivot is drawn
 * because it is the placement's origin rather than the middle of the box, and
 * a sprite anchored off-centre turns about somewhere the box does not show.
 */
function drawBox(
  target: OverlayTarget,
  gizmo: {
    readonly box: OrientedBox;
    readonly grips: readonly HandleId[];
    readonly pivot?: EditorPoint | undefined;
  },
  perScreenPixel: number,
): void {
  const box = inflated(gizmo.box, perScreenPixel);
  const line = LINE_PIXELS * perScreenPixel;
  const casing = (LINE_PIXELS + CASING_PIXELS) * perScreenPixel;
  outlineBox(target, box, line, casing);

  const radius = (HANDLE_PIXELS * perScreenPixel) / 2;
  for (const handle of boxHandles(box, gizmo.grips)) {
    target
      .rect(handle.at.x - radius, handle.at.y - radius, radius * 2, radius * 2)
      .fill({ color: MARKER_COLOR })
      .stroke({ color: CASING_COLOR, width: casing / 2 });
  }

  if (!gizmo.pivot) return;
  target
    .circle(gizmo.pivot.x, gizmo.pivot.y, radius * 0.7)
    .fill({ color: CENTRE_COLOR })
    .stroke({ color: CASING_COLOR, width: casing / 2 });
}

/** A box's four sides, cased and then coloured. */
function outlineBox(
  target: OverlayTarget,
  box: OrientedBox,
  line: number,
  casing: number,
  style: { alpha?: number } = {},
): void {
  const trace = (): void => {
    const first = cornerAt(box, { x: -1, y: -1 });
    target.moveTo(first.x, first.y);
    for (const grip of OUTLINE) {
      const at = cornerAt(box, grip);
      target.lineTo(at.x, at.y);
    }
    target.lineTo(first.x, first.y);
  };
  const alpha = style.alpha ?? 1;
  trace();
  target.stroke({ color: CASING_COLOR, width: casing, alpha: alpha * 0.55 });
  trace();
  target.stroke({ color: MARKER_COLOR, width: line, alpha });
}

/** The corners after the first, in order round the box. */
const OUTLINE = [
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

/** How heavily a placement is marked: the selection, or what it carries. */
interface MarkerStyle {
  readonly line: number;
  readonly casing: number;
  readonly alpha: number;
}

function markBox(
  target: OverlayTarget,
  box: WorldBounds,
  style: MarkerStyle,
): void {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  target
    .rect(box.minX, box.minY, width, height)
    .stroke({
      color: CASING_COLOR,
      width: style.casing,
      alpha: 0.55 * style.alpha,
    })
    .rect(box.minX, box.minY, width, height)
    .stroke({ color: MARKER_COLOR, width: style.line, alpha: style.alpha });
}

function markPoint(
  target: OverlayTarget,
  point: EditorPoint,
  arm: number,
  style: MarkerStyle,
): void {
  const cross = (): void => {
    target
      .moveTo(point.x - arm, point.y)
      .lineTo(point.x + arm, point.y)
      .moveTo(point.x, point.y - arm)
      .lineTo(point.x, point.y + arm);
  };
  cross();
  target.stroke({
    color: CASING_COLOR,
    width: style.casing,
    alpha: 0.55 * style.alpha,
  });
  cross();
  target.stroke({ color: MARKER_COLOR, width: style.line, alpha: style.alpha });
}
