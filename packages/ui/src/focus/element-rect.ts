import type { DisplayContainer } from "@yagejs/renderer";
import type { Rect } from "../positioning.js";
import type { UIElement } from "../types.js";

const topLeftInput = { x: 0, y: 0 };
const bottomRightInput = { x: 0, y: 0 };
const topLeft = { x: 0, y: 0 };
const bottomRight = { x: 0, y: 0 };

/**
 * Project an element's laid-out box into `target`'s local space, writing it
 * into `out` and reporting whether it could be read.
 *
 * A Yoga box is measured in the px of the space the element is positioned in
 * — its parent's — so both corners start there, at the container's own
 * position plus the computed size, and travel to `target` through the display
 * containers above the element. Going through the containers rather than
 * summing Yoga edges is what puts a scrolled row, an absolutely positioned
 * element and a deeply nested panel where they are drawn: a scroll offset
 * lives on a container's position, and Yoga knows nothing about it. The
 * numbers are only as fresh as the last layout pass.
 *
 * Reading the far corner out of the element's own space instead would
 * multiply the box by whatever scale sizes the element. A sprite, a nine-slice
 * and the @pixi/ui wrappers are drawn at their natural size and fitted to
 * their layout box by scale, so their rectangle would come out inflated by
 * that factor and navigation would measure distances against a box that is
 * not where the player sees the element.
 *
 * Returns `false` and leaves `out` untouched for an element whose Yoga box is
 * not a finite size, which is an element that has never been laid out.
 *
 * The intermediate points are module-level and reused, so a call allocates
 * nothing and `out` carries the only result a caller may keep.
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
  const originX = display.position.x;
  const originY = display.position.y;
  topLeftInput.x = originX;
  topLeftInput.y = originY;
  bottomRightInput.x = originX + width;
  bottomRightInput.y = originY + height;
  // An element with no parent is its own top: its position is already the
  // global one, and `toLocal` reads a point as global when `from` is absent.
  const from = display.parent ?? undefined;
  const a = target.toLocal(topLeftInput, from, topLeft);
  const b = target.toLocal(bottomRightInput, from, bottomRight);
  // A negative scale anywhere up the chain swaps the corners, so the box is
  // normalised rather than assumed to come out top-left first.
  out.x = Math.min(a.x, b.x);
  out.y = Math.min(a.y, b.y);
  out.width = Math.abs(b.x - a.x);
  out.height = Math.abs(b.y - a.y);
  return true;
}
