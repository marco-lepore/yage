import { colliderOutline } from "./colliderGeometry.js";
import type { ColliderPartConfig, ColliderShape } from "./types.js";

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

  const vertices = colliderOutline(part).map((vertex) => ({
    x: vertex.x * scaleX,
    y: vertex.y * scaleY,
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
