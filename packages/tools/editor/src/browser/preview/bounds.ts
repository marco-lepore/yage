import type { FacetReader } from "./geometry.js";
import type { Entity } from "@yagejs/core";
import { geometryOf, worldGeometryOf, outlineContains } from "./geometry.js";
import { unionBounds, type WorldBounds } from "../commands/index.js";
import type { EditorViewState } from "../store/index.js";

/**
 * How much larger than the framed rectangle the view is left, so a framed
 * placement does not sit against the edge of the canvas.
 */
export const FRAME_MARGIN = 1.2;

/**
 * The smallest extent a framed rectangle is treated as having. Without it a
 * placement whose visual has no width — an empty `Graphics` — would divide the
 * viewport by zero and frame at an infinite zoom.
 */
const MIN_FRAMED_EXTENT = 1;

/** Pick the same footprint the preview draws, including open collider segments. */
export function containsPoint(
  entity: Entity,
  point: { x: number; y: number },
  perScreenPixel = 1,
  inspector?: FacetReader,
): boolean {
  return worldGeometryOf(entity, inspector).outlines.some((outline) =>
    outlineContains(outline, point, 4 * perScreenPixel),
  );
}

/** The world rectangle covering the preview's artwork or collider fallback. */
export function worldBoundsOf(
  entity: Entity,
  inspector?: FacetReader,
): WorldBounds | undefined {
  return boundsOf(worldGeometryOf(entity, inspector));
}

/**
 * The view moved to put `bounds` in the middle of a viewport of `size`
 * rendered pixels, zoomed so the whole rectangle fits with a margin around it.
 *
 * Only the camera moves. What the viewport draws for reference is a setting
 * the developer chose, not part of where they are looking.
 */
export function framedView(
  view: EditorViewState,
  bounds: WorldBounds,
  size: { width: number; height: number },
): EditorViewState {
  const width = Math.max(bounds.maxX - bounds.minX, MIN_FRAMED_EXTENT);
  const height = Math.max(bounds.maxY - bounds.minY, MIN_FRAMED_EXTENT);
  return {
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    zoom: Math.min(
      size.width / (width * FRAME_MARGIN),
      size.height / (height * FRAME_MARGIN),
    ),
    guides: view.guides,
    snap: view.snap,
    step: view.step,
  };
}

/** The footprint before the entity transform, used by the oriented gizmo. */
export function localBoxOf(
  entity: Entity,
  inspector?: FacetReader,
): WorldBounds | undefined {
  return boundsOf(geometryOf(entity, inspector));
}

function boundsOf(
  geometry: ReturnType<typeof geometryOf>,
): WorldBounds | undefined {
  return unionBounds(
    geometry.outlines.flatMap((outline) =>
      outline.vertices.map(({ x, y }) => ({
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
      })),
    ),
  );
}
