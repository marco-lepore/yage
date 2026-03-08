import { Vec2 } from "@yage/core";
import type { ColliderConfig as PhysicsColliderConfig } from "@yage/physics";
import type { ColliderConfig } from "./types.js";

/**
 * Convert tilemap ColliderConfig[] (top-left origin rects/polygons) into
 * physics-package ColliderConfig[] (center-origin shape + offset).
 */
export function toPhysicsColliders(
  shapes: ColliderConfig[],
): PhysicsColliderConfig[] {
  return shapes.map(toPhysicsCollider);
}

function toPhysicsCollider(config: ColliderConfig): PhysicsColliderConfig {
  switch (config.type) {
    case "polygon":
      return {
        shape: {
          type: "polygon",
          vertices: config.vertices.map((v) => new Vec2(v.x, v.y)),
        },
        offset: { x: config.x, y: config.y },
      };
    case "rect":
      return {
        shape: { type: "box", width: config.width, height: config.height },
        offset: {
          x: config.x + config.width / 2,
          y: config.y + config.height / 2,
        },
      };
  }
}
