import { Point } from "pixi.js";
import type { Container } from "pixi.js";

/**
 * Derived, read-only rendered-geometry and visibility facet for a graphical
 * component, computed on demand from its live display object. For a
 * typewriter, this reports the glyphs and bounds actually painted rather than
 * only the component's declared full string.
 *
 * Owned by `@yagejs/renderer`: the renderer publishes it into the Inspector
 * snapshot through the generic {@link InspectorFacetContributor} seam (see
 * {@link RenderFacetContributor}), so `@yagejs/core` stays agnostic of any
 * rendering concept.
 *
 * `bounds` / `visible` are the cross-cutting fields. A component reporting
 * richer, mode-specific state (e.g. per-glyph visibility for split text) widens
 * the shape via the `Extra` parameter on its own side.
 */
export type RenderFacetSnapshot<Extra = unknown> = {
  /**
   * Axis-aligned bounding box of the component's geometry, in world space (the
   * same coordinate space the Inspector reports for `entity.transform` — pixels,
   * before camera/viewport projection). Measured from the geometry itself, so a
   * sized-but-hidden object still reports its real box; `null` means there is no
   * measurable geometry at all (an empty `Graphics`, a zero-area object), NOT
   * that the object is hidden. Read {@link RenderFacetSnapshot.visible} for the
   * hidden/shown state.
   */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /**
   * The component's own (local, non-inherited) visibility flag at snapshot
   * time. A hidden ancestor (e.g. a parent/layer container set invisible) is
   * NOT folded in — read the relevant parent separately if you need the fully
   * resolved on-screen state.
   */
  visible: boolean;
} & Extra;

/**
 * Renderer-internal contract a graphical component implements to publish its
 * render facet. {@link RenderFacetContributor} duck-types this off each
 * component when building an Inspector snapshot.
 */
export interface RenderInspectable {
  inspectRender(): RenderFacetSnapshot;
}

/**
 * Compute the {@link RenderFacetSnapshot} for a single display object.
 *
 * ## Bounds coordinate space
 *
 * The returned `bounds` are an axis-aligned box in **world space** — the same
 * coordinate space the Inspector reports for `entity.transform` (pixels,
 * before the camera and the responsive `fit` transform are applied). In the
 * YAGE render tree the camera transform lives on the *layer container*
 * (`DisplaySystem` writes `layer.container.position/scale/rotation`), while each
 * display object is positioned straight from `transform.worldPosition`. So a
 * display object's *own local transform* is exactly its placement within world
 * space, and mapping its local-space bounds through that matrix yields a
 * world-space box — independent of the camera, which lives one level up on the
 * parent. (This holds with or without a parent: an unparented object's local
 * transform is still its world placement, so no special-case is needed.)
 *
 * ## Why `getLocalBounds()` and not `getBounds()`
 *
 * `getBounds()` measures in *global* (screen) space and, critically, returns an
 * empty box for an object whose own `visible` flag is `false` — Pixi refuses to
 * measure invisible subtrees. That conflates "currently hidden" with "paints
 * nothing", which is exactly what `bounds: null` must NOT mean. `getLocalBounds()`
 * measures the object's own geometry in local space and does *not* gate the root
 * object on visibility (only its invisible children are skipped), so a real
 * sized-but-hidden object still reports its true box. `bounds` is therefore
 * `null` only when the object genuinely has no measurable geometry (an empty
 * `Graphics`, a zero-area display object) — never merely because it is hidden.
 * Read `visible` for the hidden/shown state.
 *
 * `getLocalBounds()` also keeps the snapshot read-only against the wider scene
 * graph: unlike `getBounds()` (which walks every ancestor calling
 * `updateLocalTransform`), it never touches ancestors, and the lone
 * `updateLocalTransform()` we call refreshes only *this* object's matrix
 * (cached / a no-op when already current).
 *
 * ## Visibility
 *
 * `visible` is the display object's *own* (local) flag — Pixi v8 has no public
 * world-resolved visibility getter, so a hidden ancestor (e.g. a layer
 * container with `visible = false`) is NOT reflected here. For the per-glyph
 * reveal use case this is exactly right (glyphs are toggled directly); callers
 * hiding an entity via a parent container should read the parent's flag too.
 */
export function computeRenderFacet(
  displayObject: Container,
): RenderFacetSnapshot {
  return {
    bounds: computeWorldBounds(displayObject),
    visible: displayObject.visible,
  };
}

function computeWorldBounds(
  displayObject: Container,
): RenderFacetSnapshot["bounds"] {
  const local = displayObject.getLocalBounds();
  if (
    !isFiniteBox(local.x, local.y, local.width, local.height) ||
    local.width === 0 ||
    local.height === 0
  ) {
    // No measurable geometry: an empty Graphics, or a collapsed axis — a
    // zero-area shape (a line, a zero-height rect) paints nothing fillable. This
    // is the ONLY reason bounds are null — a hidden-but-sized object falls through.
    return null;
  }

  // Refresh only this object's local matrix (no-op when already current), then
  // map the four local-space corners into the parent/world frame and re-derive
  // an AABB. A single-corner mapping is insufficient under rotation or
  // non-uniform scale, so we transform all four and take the extents.
  displayObject.updateLocalTransform();
  const toWorld = displayObject.localTransform;
  const corners = [
    new Point(local.x, local.y),
    new Point(local.x + local.width, local.y),
    new Point(local.x + local.width, local.y + local.height),
    new Point(local.x, local.y + local.height),
  ].map((corner) => toWorld.apply(corner));

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
