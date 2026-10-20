import type { PhysicsWorld, QuerySensorMode } from "@yagejs/physics";
import type { PerceptionContext } from "./PerceptionSensor.js";

export interface PerceptionRaycastOptions {
  filterGroups?: number;
  /** Default "exclude": trigger colliders do not block sight. */
  sensors?: QuerySensorMode;
}

/** Reuses the world's collider query. Skips observer colliders; a first hit on the target is visible. */
export function perceptionRaycast(
  world: PhysicsWorld,
  options: PerceptionRaycastOptions = {},
): (context: PerceptionContext) => boolean {
  const queryOptions = { ...options };
  return ({ observer, target, origin, position, distance }) => {
    if (distance === 0) return true;
    const hit = world.raycast(
      origin,
      { x: position.x - origin.x, y: position.y - origin.y },
      distance,
      { ...queryOptions, excludeEntity: observer },
    );
    return hit === null || hit.entity === target;
  };
}
