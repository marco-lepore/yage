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
    case "rect":
      return {
        shape: { type: "box", width: config.width, height: config.height },
        offset: {
          x: config.x + config.width / 2,
          y: config.y + config.height / 2,
        },
      };
    case "circle":
      return {
        shape: { type: "circle", radius: config.radius },
        offset: {
          x: config.x + config.width / 2,
          y: config.y + config.height / 2,
        },
      };
    case "capsule":
      return {
        shape: {
          type: "capsule",
          halfHeight: config.halfHeight,
          radius: config.radius,
          axis: config.axis,
        },
        offset: {
          x: config.x + config.width / 2,
          y: config.y + config.height / 2,
        },
      };
  }
}
