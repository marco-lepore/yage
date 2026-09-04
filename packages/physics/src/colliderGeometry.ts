import type { ColliderPartConfig, ColliderShape } from "./types.js";

interface BoxColliderGeometry {
  halfWidth: number;
  halfHeight: number;
  borderRadius: number;
  /**
   * Area of the rounded footprint over the area of the inner rectangle
   * Rapier weighs (`1` for a plain box). Multiplying the density by it
   * gives the rounded box the mass its footprint covers.
   */
  areaScale: number;
}

/**
 * @internal Return the inner extents used to preserve a box's outer
 * footprint, and the density factor that keeps its mass on the footprint.
 * The shape is validated at the entry that took it (`assertColliderShape`).
 */
export function getBoxColliderGeometry(
  shape: Extract<ColliderShape, { type: "box" }>,
): BoxColliderGeometry {
  const borderRadius = shape.borderRadius ?? 0;
  const halfWidth = shape.width / 2 - borderRadius;
  const halfHeight = shape.height / 2 - borderRadius;
  // The rounded footprint is the full rectangle minus the four corner
  // pieces a circle of the radius leaves uncovered.
  const footprintArea =
    shape.width * shape.height - (4 - Math.PI) * borderRadius * borderRadius;
  const areaScale =
    borderRadius === 0 ? 1 : footprintArea / (4 * halfWidth * halfHeight);
  return { halfWidth, halfHeight, borderRadius, areaScale };
}

/**
 * Total rotation for a collider desc: the shape's base rotation (a horizontal
 * capsule is a vertical capsule rotated 90°) plus the configured rotation.
 */
export function colliderRotation(config: ColliderPartConfig): number {
  const base =
    config.shape.type === "capsule" && config.shape.axis === "x"
      ? Math.PI / 2
      : 0;
  return base + (config.rotation ?? 0);
}
