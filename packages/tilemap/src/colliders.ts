import type {
  TilemapData,
  MapObject,
  TilemapColliderConfig,
  RectColliderConfig,
  CircleColliderConfig,
  CapsuleColliderConfig,
  PolygonColliderConfig,
  PolylineColliderConfig,
} from "./types.js";

/**
 * Extract physics-agnostic collision shapes from object layers.
 *
 * - Rectangle objects -> RectColliderConfig
 * - Tile objects (a `gid` is set) -> RectColliderConfig over the tile's box,
 *   like any rectangle: a MapObject's x/y is its top-left corner whatever the
 *   corner Tiled anchored it on
 * - Ellipse objects (width === height) -> CircleColliderConfig
 * - Ellipse objects (width !== height) -> PolygonColliderConfig sampling the
 *   ellipse outline (Rapier has no ellipse primitive; the ring is convex, so
 *   the physics-side convex hull reproduces it exactly)
 * - Capsule objects -> CapsuleColliderConfig oriented along the longer axis
 * - Polygon objects -> PolylineColliderConfig with the closing edge appended
 *   (Tiled polygons are closed outlines and may be concave; static-only)
 * - Polyline objects -> PolylineColliderConfig verbatim (open chain)
 * - Point objects -> skipped (not collision shapes)
 *
 * Object rotation (degrees in Tiled, pivoting on the object's position) is
 * honored for every shape: vertex-based shapes are rotated here, circles get
 * their center shifted, and rect/capsule configs carry `rotation` in radians.
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
 * Vertex count for the polygonal approximation of a non-circular ellipse.
 * At 24 segments the outline deviates from the true ellipse by under a pixel
 * for radii up to ~130px.
 */
const ELLIPSE_SEGMENTS = 24;

/**
 * Convert a single MapObject to a TilemapColliderConfig.
 * Returns null for point objects (not collision shapes).
 */
function objectToColliderConfig(obj: MapObject): TilemapColliderConfig | null {
  // Skip point objects
  if (obj.point) return null;

  // Tiled stores rotation in degrees, pivoting on the object's position.
  const rotation = obj.rotation ? (obj.rotation * Math.PI) / 180 : 0;

  if (obj.polygon) {
    // Tiled polygons are closed shapes with the closing edge implicit;
    // append the first vertex so the polyline chain closes the loop.
    const vertices = obj.polygon.map((v) => ({ x: v.x, y: v.y }));
    const first = vertices[0];
    if (first && vertices.length > 2) {
      vertices.push({ ...first });
    }
    const config: PolylineColliderConfig = {
      type: "polyline",
      x: obj.x,
      y: obj.y,
      vertices: rotateVertices(vertices, rotation),
    };
    return config;
  }

  if (obj.polyline) {
    const config: PolylineColliderConfig = {
      type: "polyline",
      x: obj.x,
      y: obj.y,
      vertices: rotateVertices(
        obj.polyline.map((v) => ({ x: v.x, y: v.y })),
        rotation,
      ),
    };
    return config;
  }

  if (obj.ellipse) {
    if (obj.width === obj.height) {
      const config: CircleColliderConfig = {
        type: "circle",
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        radius: obj.width / 2,
      };
      if (rotation !== 0) {
        // A rotated circle is still a circle; rotation only swings its
        // center around the top-left pivot. Bake the shift into x/y.
        const r = obj.width / 2;
        const center = rotatePoint(r, r, rotation);
        config.x = obj.x + center.x - r;
        config.y = obj.y + center.y - r;
      }
      return config;
    }
    // Rapier has no ellipse primitive: sample the outline as a convex
    // polygon. Vertices are relative to the object's top-left, matching
    // Tiled polygon convention.
    const rx = obj.width / 2;
    const ry = obj.height / 2;
    const vertices: { x: number; y: number }[] = [];
    for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
      const angle = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
      vertices.push({
        x: rx + rx * Math.cos(angle),
        y: ry + ry * Math.sin(angle),
      });
    }
    const config: PolygonColliderConfig = {
      type: "polygon",
      x: obj.x,
      y: obj.y,
      vertices: rotateVertices(vertices, rotation),
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
    if (rotation !== 0) {
      config.rotation = rotation;
    }
    return config;
  }

  // Rectangle object, and the tile object built on the same box.
  const config: RectColliderConfig = {
    type: "rect",
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
  };
  if (rotation !== 0) {
    config.rotation = rotation;
  }
  return config;
}

function rotatePoint(
  x: number,
  y: number,
  angle: number,
): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** Rotate vertices about the origin. Returns the input array when angle is 0. */
function rotateVertices(
  vertices: { x: number; y: number }[],
  angle: number,
): { x: number; y: number }[] {
  if (angle === 0) return vertices;
  return vertices.map((v) => rotatePoint(v.x, v.y, angle));
}
