import type { ColliderConfig, ColliderShape } from "./types.js";

/** Minimal Rapier interface so we don't import @dimforge/rapier2d at compile time. */
export interface RapierModule {
  ColliderDesc: {
    cuboid(hx: number, hy: number): RapierColliderDesc;
    roundCuboid(
      hx: number,
      hy: number,
      borderRadius: number,
    ): RapierColliderDesc;
    ball(radius: number): RapierColliderDesc;
    capsule(halfHeight: number, radius: number): RapierColliderDesc;
    convexHull(vertices: Float32Array): RapierColliderDesc | null;
    polyline(
      vertices: Float32Array,
      indices?: Uint32Array | null,
    ): RapierColliderDesc;
  };
}

export interface RapierColliderDesc {
  setTranslation(x: number, y: number): RapierColliderDesc;
  setRotation(angle: number): RapierColliderDesc;
  setContactSkin(thickness: number): RapierColliderDesc;
}

interface BoxColliderGeometry {
  halfWidth: number;
  halfHeight: number;
  borderRadius: number;
}

/** @internal Return the inner extents used to preserve a box's outer footprint. */
export function getBoxColliderGeometry(
  shape: Extract<ColliderShape, { type: "box" }>,
): BoxColliderGeometry {
  const borderRadius = shape.borderRadius ?? 0;
  // A non-finite radius would reach roundCuboid and trap the wasm module,
  // leaving the world unusable rather than reporting the bad input.
  if (
    !Number.isFinite(borderRadius) ||
    borderRadius < 0 ||
    (borderRadius > 0 &&
      borderRadius >= Math.min(shape.width, shape.height) / 2)
  ) {
    throw new Error(
      "Box border radius must be a finite number from 0 up to (not including) half the shorter side.",
    );
  }
  return {
    halfWidth: shape.width / 2 - borderRadius,
    halfHeight: shape.height / 2 - borderRadius,
    borderRadius,
  };
}

/**
 * Convert physics ColliderConfig[] into Rapier ColliderDesc[].
 *
 * Useful for bulk-creating static colliders (e.g. tilemap walls) without
 * full ECS setup.
 */
export function toRapierColliders(
  rapier: RapierModule,
  configs: ColliderConfig[],
  pixelsPerMeter: number,
): RapierColliderDesc[] {
  const toMeters = (v: number) => v / pixelsPerMeter;

  return configs.map((config) => {
    const desc = buildDesc(rapier, config.shape, toMeters);

    if (config.offset) {
      desc.setTranslation(toMeters(config.offset.x), toMeters(config.offset.y));
    }
    const rotation = colliderRotation(config);
    if (rotation !== 0) {
      desc.setRotation(rotation);
    }
    if (config.contactSkin !== undefined) {
      desc.setContactSkin(toMeters(config.contactSkin));
    }

    return desc;
  });
}

/**
 * Total rotation for a collider desc: the shape's base rotation (a horizontal
 * capsule is a vertical capsule rotated 90°) plus the configured rotation.
 */
export function colliderRotation(config: ColliderConfig): number {
  const base =
    config.shape.type === "capsule" && config.shape.axis === "x"
      ? Math.PI / 2
      : 0;
  return base + (config.rotation ?? 0);
}

function buildDesc(
  rapier: RapierModule,
  shape: ColliderShape,
  toMeters: (v: number) => number,
): RapierColliderDesc {
  switch (shape.type) {
    case "box": {
      const geometry = getBoxColliderGeometry(shape);
      if (geometry.borderRadius === 0) {
        return rapier.ColliderDesc.cuboid(
          toMeters(geometry.halfWidth),
          toMeters(geometry.halfHeight),
        );
      }
      return rapier.ColliderDesc.roundCuboid(
        toMeters(geometry.halfWidth),
        toMeters(geometry.halfHeight),
        toMeters(geometry.borderRadius),
      );
    }
    case "circle":
      return rapier.ColliderDesc.ball(toMeters(shape.radius));
    case "capsule":
      // The axis:"x" rotation is applied by the caller via colliderRotation.
      return rapier.ColliderDesc.capsule(
        toMeters(shape.halfHeight),
        toMeters(shape.radius),
      );
    case "polygon": {
      const verts = shape.vertices.flatMap((v) => [
        toMeters(v.x),
        toMeters(v.y),
      ]);
      const result = rapier.ColliderDesc.convexHull(new Float32Array(verts));
      if (!result) {
        throw new Error("Failed to create convex hull from vertices.");
      }
      return result;
    }
    case "polyline": {
      const verts = shape.vertices.flatMap((v) => [
        toMeters(v.x),
        toMeters(v.y),
      ]);
      return rapier.ColliderDesc.polyline(new Float32Array(verts));
    }
  }
}
