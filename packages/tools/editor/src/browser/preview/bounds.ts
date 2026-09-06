import { Transform, type Entity } from "@yagejs/core";
import { VisualComponent } from "@yagejs/renderer";
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

/** Whether a point in world space is inside any of an entity's visuals. */
export function containsPoint(
  entity: Entity,
  point: { x: number; y: number },
): boolean {
  const transform = entity.get(Transform);
  const origin = transform.worldPosition;
  const scale = transform.worldScale;
  const rotation = transform.worldRotation;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  // Into the visual's own space: undo the world rotation, then the scale.
  const localX = (dx * cos - dy * sin) / (scale.x === 0 ? 1 : scale.x);
  const localY = (dx * sin + dy * cos) / (scale.y === 0 ? 1 : scale.y);

  for (const bounds of localBoundsOf(entity)) {
    if (
      localX >= bounds.minX &&
      localX <= bounds.maxX &&
      localY >= bounds.minY &&
      localY <= bounds.maxY
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The world rectangle an entity's visuals cover, or `undefined` when it draws
 * nothing.
 *
 * Each visual's own rectangle is taken through the entity's world transform by
 * its four corners, because a rotated rectangle's axis-aligned bounds are not
 * its corners rotated in place.
 */
export function worldBoundsOf(entity: Entity): WorldBounds | undefined {
  const transform = entity.get(Transform);
  const origin = transform.worldPosition;
  const scale = transform.worldScale;
  const rotation = transform.worldRotation;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  let found: WorldBounds | undefined;
  for (const local of localBoundsOf(entity)) {
    for (const corner of corners(local)) {
      const x = corner.x * scale.x;
      const y = corner.y * scale.y;
      const point = {
        x: origin.x + x * cos - y * sin,
        y: origin.y + x * sin + y * cos,
      };
      found = found === undefined ? boundsAt(point) : grown(found, point);
    }
  }
  return found;
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

/**
 * Each visual's own rectangle, in the entity's local space.
 *
 * The pivot is subtracted because the renderer draws a display object at
 * `position + R·S·(point - pivot)`, and `SplitTextComponent` sets one for an
 * anchored block. Without the term a placement carrying anchored text frames
 * and hit-tests at a box its picture is not in.
 *
 * `VisualComponent.inspectRender()` reports this rectangle already in world
 * space. It is not used here because it reads the display object's matrix,
 * which the dormant preview refreshes at render time: a drag writes
 * `Transform` and asks for bounds in the same frame, so the answer would lag
 * the pointer by one frame.
 */
/**
 * The one rectangle covering every visual an entity draws, in the entity's own
 * space rather than the world's, or `undefined` when it draws nothing.
 *
 * This is what a gizmo drawn on the placement's own box needs: the rectangle
 * before its transform is applied, so the box can be carried out through the
 * transform and turn with it.
 */
export function localBoxOf(entity: Entity): WorldBounds | undefined {
  return unionBounds([...localBoundsOf(entity)]);
}

function* localBoundsOf(entity: Entity): Generator<WorldBounds> {
  for (const component of entity.getAll()) {
    if (!(component instanceof VisualComponent)) continue;
    const bounds = component.renderObject.getLocalBounds();
    const pivot = component.renderObject.pivot;
    yield {
      minX: bounds.x - pivot.x,
      minY: bounds.y - pivot.y,
      maxX: bounds.x + bounds.width - pivot.x,
      maxY: bounds.y + bounds.height - pivot.y,
    };
  }
}

function corners(
  bounds: WorldBounds,
): readonly { readonly x: number; readonly y: number }[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

function boundsAt(point: { x: number; y: number }): WorldBounds {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

function grown(
  bounds: WorldBounds,
  point: { x: number; y: number },
): WorldBounds {
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}
