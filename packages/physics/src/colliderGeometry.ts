import type { Vec2Like } from "@yagejs/core";
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

/** @internal The authored part outline in body-local pixels, before entity scale. */
export function colliderOutline(part: ColliderPartConfig): Vec2Like[] {
  const rotation = colliderRotation(part);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return outlineVertices(part.shape).map(({ x, y }) => ({
    x: (part.offset?.x ?? 0) + x * cos - y * sin,
    y: (part.offset?.y ?? 0) + x * sin + y * cos,
  }));
}

const CURVE_SAMPLES = 32;

function outlineVertices(shape: ColliderShape): Vec2Like[] {
  switch (shape.type) {
    case "box":
      return boxVertices(shape);
    case "circle":
      return ellipseVertices(shape.radius, shape.radius);
    case "capsule":
      return capsuleVertices(shape.halfHeight, shape.radius);
    case "polygon":
    case "polyline":
      return shape.vertices;
  }
}

function boxVertices(
  shape: Extract<ColliderShape, { type: "box" }>,
): Vec2Like[] {
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const radius = shape.borderRadius ?? 0;
  if (radius === 0) {
    return [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ];
  }

  const vertices: Vec2Like[] = [];
  const centerX = halfWidth - radius;
  const centerY = halfHeight - radius;
  const samplesPerCorner = CURVE_SAMPLES / 4;
  for (const [cx, cy, start] of [
    [centerX, -centerY, -Math.PI / 2],
    [centerX, centerY, 0],
    [-centerX, centerY, Math.PI / 2],
    [-centerX, -centerY, Math.PI],
  ] as const) {
    for (let i = 0; i <= samplesPerCorner; i++) {
      const angle = start + (i / samplesPerCorner) * (Math.PI / 2);
      vertices.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
  }
  return vertices;
}

function ellipseVertices(radiusX: number, radiusY: number): Vec2Like[] {
  return Array.from({ length: CURVE_SAMPLES }, (_, index) => {
    const angle = (index / CURVE_SAMPLES) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radiusX,
      y: Math.sin(angle) * radiusY,
    };
  });
}

function capsuleVertices(halfHeight: number, radius: number): Vec2Like[] {
  const vertices: Vec2Like[] = [];
  const halfSamples = CURVE_SAMPLES / 2;
  for (let i = 0; i <= halfSamples; i++) {
    const angle = Math.PI + (i / halfSamples) * Math.PI;
    vertices.push({
      x: Math.cos(angle) * radius,
      y: -halfHeight + Math.sin(angle) * radius,
    });
  }
  for (let i = 0; i <= halfSamples; i++) {
    const angle = (i / halfSamples) * Math.PI;
    vertices.push({
      x: Math.cos(angle) * radius,
      y: halfHeight + Math.sin(angle) * radius,
    });
  }
  return vertices;
}
