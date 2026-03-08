import type {
  TilemapData,
  MapObject,
  ColliderConfig,
  RectColliderConfig,
  PolygonColliderConfig,
} from "./types.js";

/**
 * Extract physics-agnostic collision shapes from object layers.
 *
 * - Rectangle objects -> RectColliderConfig
 * - Polygon objects -> PolygonColliderConfig
 * - Point objects -> skipped (not collision shapes)
 *
 * @param map - Generic TilemapData.
 * @param objectLayerName - Optional: only extract from this layer.
 */
export function extractCollisionShapes(
  map: TilemapData,
  objectLayerName?: string,
): ColliderConfig[] {
  const filtered = objectLayerName
    ? map.objectLayers.filter((l) => l.name === objectLayerName)
    : map.objectLayers;

  const shapes: ColliderConfig[] = [];

  for (const layer of filtered) {
    for (const obj of layer.objects) {
      const shape = objectToColliderConfig(obj);
      if (shape) shapes.push(shape);
    }
  }

  return shapes;
}

/**
 * Convert a single MapObject to a ColliderConfig.
 * Returns null for point objects (not collision shapes).
 */
function objectToColliderConfig(obj: MapObject): ColliderConfig | null {
  // Skip point objects
  if (obj.point) return null;

  if (obj.polygon) {
    const config: PolygonColliderConfig = {
      type: "polygon",
      x: obj.x,
      y: obj.y,
      vertices: obj.polygon.map((v) => ({ x: v.x, y: v.y })),
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
