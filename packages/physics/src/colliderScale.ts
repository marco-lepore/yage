import type { Vec2Like } from "@yagejs/core";
import { colliderRotation } from "./colliderGeometry.js";
import type { ColliderPartConfig, ColliderShape } from "./types.js";

const CURVE_SAMPLES = 32;

/** @internal Apply a non-zero finite entity scale to one collider part. */
export function scaleColliderPart(
  part: ColliderPartConfig,
  scaleX: number,
  scaleY: number,
): ColliderPartConfig {
  if (scaleX > 0 && scaleX === scaleY) {
    const scaled: ColliderPartConfig = {
      shape: scaleUniformShape(part.shape, scaleX),
    };
    if (part.offset) {
      scaled.offset = {
        x: part.offset.x * scaleX,
        y: part.offset.y * scaleY,
      };
    }
    if (part.rotation !== undefined) scaled.rotation = part.rotation;
    return scaled;
  }

  const rotation = colliderRotation(part);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const offsetX = part.offset?.x ?? 0;
  const offsetY = part.offset?.y ?? 0;
  const vertices = outlineVertices(part.shape).map((vertex) => ({
    x: (vertex.x * cos - vertex.y * sin + offsetX) * scaleX,
    y: (vertex.x * sin + vertex.y * cos + offsetY) * scaleY,
  }));

  return {
    shape:
      part.shape.type === "polyline"
        ? { type: "polyline", vertices }
        : { type: "polygon", vertices },
  };
}

function scaleUniformShape(shape: ColliderShape, scale: number): ColliderShape {
  switch (shape.type) {
    case "box":
      return {
        type: "box",
        width: shape.width * scale,
        height: shape.height * scale,
        ...(shape.borderRadius === undefined
          ? {}
          : { borderRadius: shape.borderRadius * scale }),
      };
    case "circle":
      return { type: "circle", radius: shape.radius * scale };
    case "capsule":
      return {
        type: "capsule",
        halfHeight: shape.halfHeight * scale,
        radius: shape.radius * scale,
        ...(shape.axis === undefined ? {} : { axis: shape.axis }),
      };
    case "polygon":
    case "polyline":
      return {
        type: shape.type,
        vertices: shape.vertices.map((vertex) => ({
          x: vertex.x * scale,
          y: vertex.y * scale,
        })),
      };
  }
}

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
    for (let i = 0; i < samplesPerCorner; i++) {
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
  for (let i = 1; i < halfSamples; i++) {
    const angle = (i / halfSamples) * Math.PI;
    vertices.push({
      x: Math.cos(angle) * radius,
      y: halfHeight + Math.sin(angle) * radius,
    });
  }
  return vertices;
}
