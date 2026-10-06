import type { ColliderComponent } from "./ColliderComponent.js";
import { colliderRotation } from "./colliderGeometry.js";
import type {
  ColliderShape,
  ContactCandidate,
  ContactFilter,
} from "./types.js";
import { colliderPairKey } from "./colliderParts.js";

const DEFAULT_DIRECTION_X = 0;
const DEFAULT_DIRECTION_Y = -1;
const DEFAULT_MARGIN = 4;

/**
 * Farthest reach of a shape from its collider origin (in pixels) along a
 * unit direction given in the collider's local frame. For a box this is the
 * half-extent projection; for an off-center polygon it is the actual
 * support distance, which may differ per direction.
 */
function supportExtent(shape: ColliderShape, ux: number, uy: number): number {
  switch (shape.type) {
    case "box": {
      const borderRadius = shape.borderRadius ?? 0;
      // Rounded corners add a constant support distance in every direction.
      return (
        (shape.width / 2 - borderRadius) * Math.abs(ux) +
        (shape.height / 2 - borderRadius) * Math.abs(uy) +
        borderRadius
      );
    }
    case "circle":
      return shape.radius;
    case "capsule":
      // In its own frame a capsule is always y-axis: the axis:"x" turn is
      // part of the collider's rotation, which the caller has already
      // removed from the direction.
      return shape.halfHeight * Math.abs(uy) + shape.radius;
    case "polygon":
    case "polyline": {
      let max = -Infinity;
      for (const v of shape.vertices) {
        const d = v.x * ux + v.y * uy;
        if (d > max) max = d;
      }
      return max === -Infinity ? 0 : max;
    }
  }
}

/**
 * @internal Contact filter implementing the one-way platform rule for a
 * collider configured with `oneWay`. The platform is solid for a body whose
 * near edge was at or above the solid face at the start of the step, and
 * passable for everything else — so a body lands from the solid side, jumps
 * through from the passable side, and a body already inside the platform is
 * let out instead of being snapped to the surface.
 *
 * A delayed contact can first appear after the body has crossed the face.
 * The last advancing step's collider poses preserve which side it came
 * from, even if game code has since changed either body's velocity.
 * Once a contact has started, the platform's `_oneWayLanded` set
 * keeps the pair solid for as long as the contact lasts — the position rule
 * alone would hand the rider back to gravity while the solver is still
 * pushing a deep first impact out.
 *
 * "Above" is measured along the configured direction, rotated with the
 * platform's body. Teleports, shape changes and re-enabling invalidate the
 * recorded poses, so discontinuous movement cannot count as arrival.
 */
export function createOneWayFilter(self: ColliderComponent): ContactFilter {
  return (contact: ContactCandidate): boolean => {
    const config = self.config;
    const oneWay = config.oneWay;
    if (!oneWay) return true;

    if (contact.otherCollider.isDroppingThrough) return false;

    const selfHandle = self._colliderHandles[contact.selfShapeIndex];
    const otherHandle =
      contact.otherCollider._colliderHandles[contact.otherShapeIndex];
    if (
      selfHandle !== undefined &&
      otherHandle !== undefined &&
      self._oneWayLanded?.has(colliderPairKey(selfHandle, otherHandle))
    ) {
      return true;
    }

    return (
      isOnSolidSide(self, contact, false) || isOnSolidSide(self, contact, true)
    );
  };
}

/** Test current geometry, or the geometry before the last advancing step. */
function isOnSolidSide(
  self: ColliderComponent,
  contact: ContactCandidate,
  previous: boolean,
): boolean {
  const selfPose = previous
    ? self._previousPose(contact.selfShapeIndex)
    : undefined;
  const otherPose = previous
    ? contact.otherCollider._previousPose(contact.otherShapeIndex)
    : undefined;
  if (previous && (!selfPose || !otherPose)) return false;
  if (otherPose?.droppingThrough) return false;

  const selfRotation = selfPose?.rotation ?? contact.selfRotation;
  const otherRotation = otherPose?.rotation ?? contact.otherRotation;
  const selfPart = self._effectivePart(contact.selfShapeIndex);
  const otherPart = contact.otherCollider._effectivePart(
    contact.otherShapeIndex,
  );
  const oneWay = self.config.oneWay;
  const direction = self._scaleDirection({
    x: oneWay?.direction?.x ?? DEFAULT_DIRECTION_X,
    y: oneWay?.direction?.y ?? DEFAULT_DIRECTION_Y,
  });
  const len = Math.hypot(direction.x, direction.y);

  // The solid-face direction is body-local; each part has its own rotation.
  const bodyRotation = selfRotation - colliderRotation(selfPart);
  const cosB = Math.cos(bodyRotation);
  const sinB = Math.sin(bodyRotation);
  const nx = (direction.x * cosB - direction.y * sinB) / len;
  const ny = (direction.x * sinB + direction.y * cosB) / len;
  const relN =
    ((otherPose?.x ?? contact.otherX) - (selfPose?.x ?? contact.selfX)) * nx +
    ((otherPose?.y ?? contact.otherY) - (selfPose?.y ?? contact.selfY)) * ny;

  // Both support extents along the normal, each in its collider's frame.
  const cosS = Math.cos(selfRotation);
  const sinS = Math.sin(selfRotation);
  const selfExtent = supportExtent(
    selfPart.shape,
    nx * cosS + ny * sinS,
    -nx * sinS + ny * cosS,
  );
  const cosO = Math.cos(otherRotation);
  const sinO = Math.sin(otherRotation);
  const otherExtent = supportExtent(
    otherPart.shape,
    -nx * cosO - ny * sinO,
    nx * sinO - ny * cosO,
  );

  return relN >= selfExtent + otherExtent - (oneWay?.margin ?? DEFAULT_MARGIN);
}
