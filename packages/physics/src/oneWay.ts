import type { ColliderComponent } from "./ColliderComponent.js";
import { colliderRotation } from "./toRapierColliders.js";
import type {
  ColliderShape,
  ContactCandidate,
  ContactFilter,
} from "./types.js";

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
    case "box":
      return (
        (shape.width / 2) * Math.abs(ux) + (shape.height / 2) * Math.abs(uy)
      );
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
 * A body is judged by where it was one step before the pair is tested: the
 * narrow phase sees start-of-step poses, so an approaching body shows up
 * already past the face by up to one step of travel, and its position is
 * extended back along the approach velocity to decide which side it came
 * from. Once a contact has started, the platform's `_oneWayLanded` set
 * keeps the pair solid for as long as the contact lasts — the position rule
 * alone would hand the rider back to gravity while the solver is still
 * pushing a deep first impact out.
 *
 * "Above" is measured along the configured direction, rotated with the
 * platform's body. Everything is read live from the two configs and the
 * candidate, so `setShape`, config edits, and `dropThrough` need no
 * recomputation hooks here.
 */
export function createOneWayFilter(self: ColliderComponent): ContactFilter {
  return (contact: ContactCandidate): boolean => {
    const config = self.config;
    const oneWay = config.oneWay;
    if (!oneWay) return true;

    if (contact.otherCollider.isDroppingThrough) return false;

    if (self._oneWayLanded?.has(contact.otherCollider._colliderHandle)) {
      return true;
    }

    const dirX = oneWay.direction?.x ?? DEFAULT_DIRECTION_X;
    const dirY = oneWay.direction?.y ?? DEFAULT_DIRECTION_Y;
    const len = Math.hypot(dirX, dirY);
    if (len === 0) return true;

    // The solid-face normal, taken from the body's local frame to world.
    const relRotation = colliderRotation(config);
    const bodyRotation = contact.selfRotation - relRotation;
    const cosB = Math.cos(bodyRotation);
    const sinB = Math.sin(bodyRotation);
    const nx = (dirX * cosB - dirY * sinB) / len;
    const ny = (dirX * sinB + dirY * cosB) / len;

    // Separation of the collider origins along the normal. Rapier detects
    // pairs at start-of-step poses, so a falling body is first tested up to
    // one step's travel past the face; extending its position one step back
    // along the approach velocity recovers which side it came from.
    const relN =
      (contact.otherX - contact.selfX) * nx +
      (contact.otherY - contact.selfY) * ny;
    const relVN =
      (contact.otherVelocityX - contact.selfVelocityX) * nx +
      (contact.otherVelocityY - contact.selfVelocityY) * ny;
    const effectiveRelN = relN + Math.max(0, -relVN) * contact.dt;

    // Both support extents along the normal, each in its collider's frame.
    const cosS = Math.cos(contact.selfRotation);
    const sinS = Math.sin(contact.selfRotation);
    const selfExtent = supportExtent(
      config.shape,
      nx * cosS + ny * sinS,
      -nx * sinS + ny * cosS,
    );
    const otherRotation = contact.otherRotation;
    const cosO = Math.cos(otherRotation);
    const sinO = Math.sin(otherRotation);
    const otherExtent = supportExtent(
      contact.otherCollider.config.shape,
      -nx * cosO - ny * sinO,
      nx * sinO - ny * cosO,
    );

    const margin = oneWay.margin ?? DEFAULT_MARGIN;
    return effectiveRelN >= selfExtent + otherExtent - margin;
  };
}
