import type { WorldBounds } from "../commands/index.js";
import { latticeMultiple } from "../store/index.js";
import { CASING_COLOR, type OverlayTarget } from "./overlay.js";

/** What the guides show this frame. */
export interface GuideView {
  /** The world rectangle the whole canvas covers, so the grid fills it. */
  readonly world: WorldBounds;
  /** The harness renderer's design size, which the viewport box draws at. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** World units per screen pixel, the same number the gizmo is sized in. */
  readonly perScreenPixel: number;
  /**
   * The lattice, in world units: what a snapped gesture lands on, and what the
   * grid draws multiples of. One lattice, so every line drawn is a place a
   * gesture can land.
   */
  readonly step: number;
}

/**
 * The narrowest the fine lines are allowed to get on screen, in CSS pixels.
 *
 * Small enough that the major lines — four or five fine ones apart — still
 * land on the canvas several times over. A fine step wide enough to read
 * comfortably on its own puts its major at 400 pixels or more, which on a
 * viewport panel is one line, usually behind the world axis.
 *
 * It also bounds the work: at 24 pixels apart a canvas holds at most its own
 * width over 24 lines, whatever the zoom, so nothing has to cap the count.
 */
export const MIN_GRID_PIXELS = 24;

/**
 * The spacings, in world units, at a given zoom: the fine lines and the
 * heavier ones that make them countable.
 *
 * The fine step is the smallest whole multiple of the lattice — `1, 2, 5, 10,
 * 20, 50, …` times it — that is at least {@link MIN_GRID_PIXELS} apart on
 * screen. Consecutive candidates differ by at most 2.5, so once the lattice
 * itself is too fine to read the gap on screen lands between 24 and 60 pixels
 * however far the view is zoomed, and a major one between 96 and 300. Zoomed
 * in past that, the lattice is drawn as it stands: nothing finer exists to
 * land on.
 *
 * Major lines are two candidates up — 1 to 5, 2 to 10, 5 to 20 — which is
 * four or five fine lines to a major one, so the fine lines always divide a
 * major spacing evenly.
 */
export function gridSteps(
  perScreenPixel: number,
  step: number,
): {
  fine: number;
  major: number;
} {
  const { times, span } = latticeMultiple(
    (MIN_GRID_PIXELS * perScreenPixel) / step,
  );
  const fine = times * step;
  return { fine, major: fine * span };
}

/**
 * Every multiple of `step` inside `[from, to]`, in order.
 *
 * Counted from an integer index rather than added up from the first line: the
 * addition drifts across a wide view, and a step that rounded to zero would
 * never reach the end.
 */
export function gridLines(
  from: number,
  to: number,
  step: number,
): readonly number[] {
  const first = Math.ceil(from / step);
  const last = Math.floor(to / step);
  const lines: number[] = [];
  for (let index = first; index <= last; index += 1) lines.push(index * step);
  return lines;
}

const FINE_COLOR = 0x1e293b;
const MAJOR_COLOR = 0x475569;
const AXIS_X_COLOR = 0x7f1d1d;
const AXIS_Y_COLOR = 0x14532d;
const VIEWPORT_COLOR = 0x64748b;
const LINE_PIXELS = 1;
const AXIS_PIXELS = 2;

/**
 * Draw the grid, the world axes, and the rectangle the game starts out
 * showing.
 *
 * These sit under the placements rather than over them, on their own layer, so
 * a level is never read through its own grid. Every width is a screen-pixel
 * count taken into world units, which keeps a line one pixel wide however far
 * the view is zoomed.
 */
export function drawGuides(target: OverlayTarget, view: GuideView): void {
  target.clear();
  const line = LINE_PIXELS * view.perScreenPixel;
  const { fine, major } = gridSteps(view.perScreenPixel, view.step);
  const world = view.world;

  // The fine lines first and the major ones over them, so a line that is both
  // is drawn as a major one.
  for (const [step, color] of [
    [fine, FINE_COLOR],
    [major, MAJOR_COLOR],
  ] as const) {
    for (const x of gridLines(world.minX, world.maxX, step)) {
      target.moveTo(x, world.minY).lineTo(x, world.maxY);
    }
    for (const y of gridLines(world.minY, world.maxY, step)) {
      target.moveTo(world.minX, y).lineTo(world.maxX, y);
    }
    target.stroke({ color, width: line });
  }

  // The world axes, in the colours the gizmo gives the same two directions.
  const axis = AXIS_PIXELS * view.perScreenPixel;
  target
    .moveTo(world.minX, 0)
    .lineTo(world.maxX, 0)
    .stroke({ color: AXIS_X_COLOR, width: axis });
  target
    .moveTo(0, world.minY)
    .lineTo(0, world.maxY)
    .stroke({ color: AXIS_Y_COLOR, width: axis });

  // What the game shows before anything moves its camera: a camera at the
  // origin, unzoomed, covers the design size centred there.
  const halfWidth = view.viewport.width / 2;
  const halfHeight = view.viewport.height / 2;
  target
    .rect(-halfWidth, -halfHeight, view.viewport.width, view.viewport.height)
    .stroke({ color: CASING_COLOR, width: axis * 2, alpha: 0.4 })
    .rect(-halfWidth, -halfHeight, view.viewport.width, view.viewport.height)
    .stroke({ color: VIEWPORT_COLOR, width: axis });
}
