import type { DisplayContainer } from "@yagejs/renderer";
import type { Rect } from "../positioning.js";
import type { UIElement } from "../types.js";

const cornerInput = { x: 0, y: 0 };
const corner = { x: 0, y: 0 };

/**
 * Project the box an element is drawn in into `target`'s local space, writing
 * it into `out`: the element's Yoga-sized `(0, 0, width, height)` carried
 * through its own transform and every container above it, as the axis-aligned
 * box around the four projected corners. A scroll offset is included.
 *
 * Returns `false`, leaving `out` untouched, for an element never laid out or
 * drawn with no area: scaled to 0 itself, inside a container scaled to 0, or
 * under a `target` scaled to 0. Focus skips such an element and its tooltip
 * hides. The intermediate points are module-level and reused; keep only
 * `out`.
 */
export function readElementRect(
  target: DisplayContainer,
  element: UIElement,
  out: Rect,
): boolean {
  const width = element.yogaNode.getComputedWidth();
  const height = element.yogaNode.getComputedHeight();
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  const display = element.displayObject;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  // The two edges leaving the first corner, to tell whether the drawn
  // parallelogram has any area once rotated.
  let x0 = 0;
  let y0 = 0;
  let ux = 0;
  let uy = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < 4; i += 1) {
    cornerInput.x = i === 1 || i === 2 ? width : 0;
    cornerInput.y = i >= 2 ? height : 0;
    const p = target.toLocal(cornerInput, display, corner);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (i === 0) {
      x0 = p.x;
      y0 = p.y;
    } else if (i === 1) {
      ux = p.x - x0;
      uy = p.y - y0;
    } else if (i === 3) {
      vx = p.x - x0;
      vy = p.y - y0;
    }
    if (p.x < left) left = p.x;
    if (p.x > right) right = p.x;
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  if (hasNoArea(ux, uy, vx, vy)) return false;
  out.x = left;
  out.y = top;
  out.width = right - left;
  out.height = bottom - top;
  return true;
}

/**
 * Whether the parallelogram spanned by edges `u` and `v` has no area: an edge
 * of length 0, or the two edges parallel. The tolerance is relative to the
 * edge lengths, so rounding in the projection of a flattened box still counts
 * as flat.
 */
function hasNoArea(ux: number, uy: number, vx: number, vy: number): boolean {
  const cross = ux * vy - uy * vx;
  return Math.abs(cross) <= 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy);
}
