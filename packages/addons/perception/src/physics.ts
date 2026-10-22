import { PhysicsWorldKey } from "@yagejs/physics";
import type { QuerySensorMode } from "@yagejs/physics";
import type { PerceptionContext } from "./PerceptionSensor.js";

export interface PerceptionRaycastOptions {
  /** Collision groups the ray tests against. Default: every group. */
  filterGroups?: number;
  /** Default "exclude": trigger colliders do not block sight. */
  sensors?: QuerySensorMode;
}

/**
 * Line-of-sight check that casts one ray through the observer scene's
 * physics world. Skips the observer's own colliders; no hit, or a first hit
 * on the target, counts as a clear path.
 */
export function perceptionRaycast(
  options: PerceptionRaycastOptions = {},
): (context: PerceptionContext) => boolean {
  return ({ observer, target, origin, position, distance }) => {
    if (distance === 0) return true;
    const hit = observer.scene
      .use(PhysicsWorldKey)
      .raycast(
        origin,
        { x: position.x - origin.x, y: position.y - origin.y },
        distance,
        { ...options, excludeEntity: observer },
      );
    return hit === null || hit.entity === target;
  };
}
