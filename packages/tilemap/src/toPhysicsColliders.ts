import type { ColliderConfig as PhysicsColliderConfig } from "@yage/physics";
import type { TilemapColliderConfig } from "./types.js";

/**
 * Convert tilemap TilemapColliderConfig[] (top-left origin rects/polygons) into
 * physics-package ColliderConfig[] (center-origin shape + offset).
 */
export function toPhysicsColliders(
  shapes: TilemapColliderConfig[],
): PhysicsColliderConfig[] {
  return shapes.map(toPhysicsCollider);
}

function toPhysicsCollider(config: TilemapColliderConfig): PhysicsColliderConfig {
  switch (config.type) {
    case "polygon":
      return {
        shape: {
          type: "polygon",
          vertices: config.vertices,
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
