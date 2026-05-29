import type { RenderFacetSnapshot } from "@yagejs/core";
import { Point } from "pixi.js";
import type { Container } from "pixi.js";

/**
 * Compute the {@link RenderFacetSnapshot} for a single display object.
 *
 * ## Bounds coordinate space
 *
 * The returned `bounds` are an axis-aligned box in **world space** — the same
 * coordinate space the Inspector reports for `entity.transform` (pixels,
 * before the camera and the responsive `fit` transform are applied). In the
 * YAGE render tree the camera transform lives on the *layer container*
 * (`DisplaySystem` writes `layer.container.position/scale/rotation`), while the
 * display object's own position is set straight from `transform.worldPosition`.
 * So the display object's parent frame *is* world space, and we measure bounds
 * there: take the object's global (screen) bounds and map the corners back into
 * the parent's local space.
 *
 * When the object is not yet parented (pre-`onAdd`, mid-teardown) we fall back
 * to its untransformed local bounds offset by its own position — still a
 * world-space box for an unparented object, just without an ancestor frame to
 * resolve against.
 *
 * Returns `bounds: null` when the object reports a zero-area / non-finite box
 * (e.g. an empty `Graphics`), so consumers can distinguish "nothing painted"
 * from a real 0×0 origin box.
 *
 * ## Visibility
 *
 * `visible` is the display object's *own* (local) flag — Pixi v8 has no public
 * world-resolved visibility getter, so a hidden ancestor (e.g. a layer
 * container with `visible = false`) is NOT reflected here. For the per-glyph
 * reveal use case this is exactly right (glyphs are toggled directly); callers
 * hiding an entity via a parent container should read the parent's flag too.
 */
export function computeRenderFacet(displayObject: Container): RenderFacetSnapshot {
  return {
    bounds: computeWorldBounds(displayObject),
    visible: displayObject.visible,
  };
}

function computeWorldBounds(
  displayObject: Container,
): RenderFacetSnapshot["bounds"] {
  const parent = displayObject.parent;
  const global = displayObject.getBounds();
  if (!isFiniteBox(global.x, global.y, global.width, global.height)) {
    return null;
  }
  if (global.width === 0 && global.height === 0) {
    return null;
  }

  if (!parent) {
    // Unparented: global bounds already live in the object's own frame.
    return {
      x: global.x,
      y: global.y,
      width: global.width,
      height: global.height,
    };
  }

  // Map the four global corners into the parent (world) frame and re-derive
  // an AABB — a non-uniform camera scale or rotation makes a single corner
  // mapping insufficient.
  const corners = [
    new Point(global.x, global.y),
    new Point(global.x + global.width, global.y),
    new Point(global.x + global.width, global.y + global.height),
    new Point(global.x, global.y + global.height),
  ].map((corner) => parent.toLocal(corner));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x;
    if (corner.y < minY) minY = corner.y;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.y > maxY) maxY = corner.y;
  }

  if (!isFiniteBox(minX, minY, maxX - minX, maxY - minY)) {
    return null;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isFiniteBox(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height)
  );
}
