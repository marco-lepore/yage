import type { ColliderConfig, ColliderShape } from "./types.js";

/** Minimal Rapier interface so we don't import @dimforge/rapier2d at compile time. */
export interface RapierModule {
  ColliderDesc: {
    cuboid(hx: number, hy: number): RapierColliderDesc;
    ball(radius: number): RapierColliderDesc;
    capsule(halfHeight: number, radius: number): RapierColliderDesc;
    convexHull(vertices: Float32Array): RapierColliderDesc | null;
  };
}

export interface RapierColliderDesc {
  setTranslation(x: number, y: number): RapierColliderDesc;
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

    return desc;
  });
}

function buildDesc(
  rapier: RapierModule,
  shape: ColliderShape,
  toMeters: (v: number) => number,
): RapierColliderDesc {
  switch (shape.type) {
    case "box":
      return rapier.ColliderDesc.cuboid(
        toMeters(shape.width / 2),
        toMeters(shape.height / 2),
      );
    case "circle":
      return rapier.ColliderDesc.ball(toMeters(shape.radius));
    case "capsule":
      return rapier.ColliderDesc.capsule(
        toMeters(shape.halfHeight),
        toMeters(shape.radius),
      );
    case "polygon": {
      const verts = shape.vertices.flatMap((v) => [toMeters(v.x), toMeters(v.y)]);
      const result = rapier.ColliderDesc.convexHull(new Float32Array(verts));
      if (!result) {
        throw new Error("Failed to create convex hull from vertices.");
      }
      return result;
    }
  }
}
