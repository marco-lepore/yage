import type { DisplayContainer } from "@yagejs/renderer";
import type { Rect } from "../positioning.js";
import type { UIElement } from "../types.js";

const topLeftInput = { x: 0, y: 0 };
const bottomRightInput = { x: 0, y: 0 };
const topLeft = { x: 0, y: 0 };
const bottomRight = { x: 0, y: 0 };

/**
 * Project an element's laid-out box into `target`'s local space, writing it
 * into `out`. Returns `false` and leaves `out` untouched for an element that
 * has never been laid out. The numbers are as fresh as the last layout pass.
 *
 * Both corners start in the parent's space (the container's position plus the
 * Yoga size) and travel to `target` through the display containers. That
 * picks up a scroll offset, which lives on a container's position and which
 * Yoga does not know. Reading the far corner from the element's own space
 * would multiply the box by the scale that fits a sprite, a nine-slice or a
 * @pixi/ui wrapper to its layout box.
 *
 * The intermediate points are module-level and reused; keep only `out`.
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
  // A negative scale up the chain swaps the corners, so normalise.
  out.x = Math.min(a.x, b.x);
  out.y = Math.min(a.y, b.y);
  out.width = Math.abs(b.x - a.x);
  out.height = Math.abs(b.y - a.y);
  return true;
}
