// ─── Generic Tilemap Types (format-agnostic) ────────────────────────

export interface TilemapData {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tileLayers: TileLayerData[];
  objectLayers: ObjectLayerData[];
}

export interface TileLayerData {
  name: string;
  data: number[];
  width: number;
  height: number;
  visible: boolean;
}

export interface ObjectLayerData {
  name: string;
  objects: MapObject[];
  visible: boolean;
}

export interface MapObject {
  id: number;
  name: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  polygon?: { x: number; y: number }[];
  polyline?: { x: number; y: number }[];
  ellipse?: boolean;
  capsule?: boolean;
  properties?: MapObjectProperty[];
}

export interface MapObjectProperty {
  name: string;
  type: string;
  value: unknown;
}

/** Interface for anything that has a `properties` array (MapObject, etc.). */
export interface HasProperties {
  properties?: MapObjectProperty[];
}

// ─── Collision Shape Types (physics-agnostic) ───────────────────────

/**
 * All shape configs store `x`/`y` as the top-left corner of the object's
 * bounding box (matching Tiled's coordinate convention). Rect and capsule
 * configs may carry a `rotation` about that corner; vertex-based shapes and
 * circles have rotation already applied at extraction. `toPhysicsColliders`
 * converts to the center-origin offsets that Rapier expects.
 */

export interface RectColliderConfig {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians about the `(x, y)` pivot. Absent when 0. */
  rotation?: number;
}

export interface CircleColliderConfig {
  type: "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface CapsuleColliderConfig {
  type: "capsule";
  x: number;
  y: number;
  width: number;
  height: number;
  halfHeight: number;
  radius: number;
  /** Orientation of the capsule's long axis. */
  axis: "x" | "y";
  /** Rotation in radians about the `(x, y)` pivot. Absent when 0. */
  rotation?: number;
}

/**
 * Closed convex outline (still passed through Rapier's `convexHull`).
 * Use `polyline` for non-convex shapes; see `PolylineColliderConfig`.
 */
export interface PolygonColliderConfig {
  type: "polygon";
  x: number;
  y: number;
  vertices: { x: number; y: number }[];
}

/**
 * Chain of line segments. Non-convex, static-only (no inertia computed).
 * Best for tilemap-driven world boundaries authored as Tiled polygons.
 */
export interface PolylineColliderConfig {
  type: "polyline";
  x: number;
  y: number;
  vertices: { x: number; y: number }[];
}

export type TilemapColliderConfig =
  | RectColliderConfig
  | CircleColliderConfig
  | CapsuleColliderConfig
  | PolygonColliderConfig
  | PolylineColliderConfig;
