import type { ColliderConfig as PhysicsColliderConfig } from "@yagejs/physics";
import type { TilemapColliderConfig } from "./types.js";

/**
 * Convert tilemap TilemapColliderConfig[] (top-left origin rects/polygons) into
 * physics-package ColliderConfig[] (center-origin shape + offset).
 *
 * Notes:
 * - Tiled polygons are emitted as `polyline` (chain) shapes — they're authored
 *   as outlines and may be concave. Polyline colliders are static-only.
 * - Ellipse → `circle` (Rapier has no ellipse primitive).
 * - Capsule → `capsule` with `axis` preserved (vertical or horizontal).
 * - Rect/capsule `rotation` is forwarded to the physics config and the
 *   center offset is rotated about the shape's top-left pivot.
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
    case "polyline":
      return {
        shape: {
          type: "polyline",
          vertices: config.vertices,
        },
        offset: { x: config.x, y: config.y },
      };
    case "rect": {
      const result: PhysicsColliderConfig = {
        shape: { type: "box", width: config.width, height: config.height },
        offset: bboxCenter(config),
      };
      if (config.rotation) {
        result.rotation = config.rotation;
      }
      return result;
    }
    case "circle":
      return {
        shape: { type: "circle", radius: config.radius },
        offset: bboxCenter(config),
      };
    case "capsule": {
      const result: PhysicsColliderConfig = {
        shape: {
          type: "capsule",
          halfHeight: config.halfHeight,
          radius: config.radius,
          axis: config.axis,
        },
        offset: bboxCenter(config),
      };
      if (config.rotation) {
        result.rotation = config.rotation;
      }
      return result;
    }
  }
}

/**
 * Center of the shape's bounding box in map pixels. A rotated config pivots
 * on its top-left `(x, y)`, so the center swings around that corner.
 */
function bboxCenter(config: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}): { x: number; y: number } {
  const hx = config.width / 2;
  const hy = config.height / 2;
  if (!config.rotation) {
    return { x: config.x + hx, y: config.y + hy };
  }
  const cos = Math.cos(config.rotation);
  const sin = Math.sin(config.rotation);
  return {
    x: config.x + hx * cos - hy * sin,
    y: config.y + hx * sin + hy * cos,
  };
}
