import type {
  TilemapData,
  MapObject,
  TilemapColliderConfig,
  RectColliderConfig,
  CircleColliderConfig,
  CapsuleColliderConfig,
  PolylineColliderConfig,
} from "./types.js";

/**
 * Extract physics-agnostic collision shapes from object layers.
 *
 * - Rectangle objects -> RectColliderConfig
 * - Ellipse objects (width === height) -> CircleColliderConfig
 * - Ellipse objects (width !== height) -> CircleColliderConfig with the wider
 *   radius (Rapier has no real ellipse primitive), with a dev warning
 * - Capsule objects -> CapsuleColliderConfig oriented along the longer axis
 * - Polygon objects -> PolylineColliderConfig (Tiled polygons are authored as
 *   outlines and may be concave; static-only)
 * - Point objects -> skipped (not collision shapes)
 *
 * @param map - Generic TilemapData.
 * @param objectLayerName - Optional: only extract from this layer.
 */
export function extractCollisionShapes(
  map: TilemapData,
  objectLayerName?: string,
): TilemapColliderConfig[] {
  const filtered = objectLayerName
    ? map.objectLayers.filter((l) => l.name === objectLayerName)
    : map.objectLayers;

  const shapes: TilemapColliderConfig[] = [];

  for (const layer of filtered) {
    for (const obj of layer.objects) {
      const shape = objectToColliderConfig(obj);
      if (shape) shapes.push(shape);
    }
  }

  return shapes;
}

/**
 * Convert a single MapObject to a TilemapColliderConfig.
 * Returns null for point objects (not collision shapes).
 */
function objectToColliderConfig(obj: MapObject): TilemapColliderConfig | null {
  // Skip point objects
  if (obj.point) return null;

  if (obj.polygon) {
    const config: PolylineColliderConfig = {
      type: "polyline",
      x: obj.x,
      y: obj.y,
      vertices: obj.polygon.map((v) => ({ x: v.x, y: v.y })),
    };
    return config;
  }

  if (obj.ellipse) {
    // Rapier 2D doesn't support real ellipses; collapse to a circle.
    if (obj.width !== obj.height) {
      console.warn(
        `[@yagejs/tilemap] Ellipse object ${obj.id} ("${obj.name}") is ` +
          `${obj.width}x${obj.height}; Rapier has no ellipse primitive. ` +
          `Falling back to a circle with the wider radius. Author it as a ` +
          `capsule (set the "capsule" flag) for a true non-circular round shape.`,
      );
    }
    const radius = Math.max(obj.width, obj.height) / 2;
    const config: CircleColliderConfig = {
      type: "circle",
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      radius,
    };
    return config;
  }

  if (obj.capsule) {
    const longer = Math.max(obj.width, obj.height);
    const shorter = Math.min(obj.width, obj.height);
    const config: CapsuleColliderConfig = {
      type: "capsule",
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      halfHeight: (longer - shorter) / 2,
      radius: shorter / 2,
      axis: obj.height >= obj.width ? "y" : "x",
    };
    return config;
  }

  // Rectangle object
  const config: RectColliderConfig = {
    type: "rect",
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
  };
  return config;
}
