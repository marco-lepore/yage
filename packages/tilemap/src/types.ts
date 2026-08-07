// ─── Generic Tilemap Types (format-agnostic) ────────────────────────

export type TilemapDiagnosticCode =
  | "unsupported-orientation"
  | "infinite-map"
  | "chunked-layer"
  | "encoded-layer-data"
  | "group-layer"
  | "image-layer"
  | "tsx-tileset"
  | "unresolved-tileset"
  | "layer-parallax"
  | "unsupported-tile-animation";

export interface TilemapDiagnostic {
  code: TilemapDiagnosticCode;
  /** Sentence naming what was found and what it costs. */
  message: string;
  /**
   * `"error"`: authored content is dropped or will render wrong.
   * `"warning"`: an authored setting the renderer ignores.
   */
  severity: "error" | "warning";
  /** Layer name, when the diagnostic is about a layer. */
  layer?: string;
  /** Tileset name or `source`, when the diagnostic is about a tileset. */
  tileset?: string;
}

export interface TilemapData {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  properties?: MapObjectProperty[];
  tileLayers: TileLayerData[];
  objectLayers: ObjectLayerData[];
  tilesets: TilesetInfo[];
  diagnostics: TilemapDiagnostic[];
}

export interface TileLayerData {
  name: string;
  data: number[];
  width: number;
  height: number;
  visible: boolean;
  offsetX: number;
  offsetY: number;
  properties?: MapObjectProperty[];
}

export interface ObjectLayerData {
  name: string;
  /** Object coordinates already include this layer offset. */
  objects: MapObject[];
  visible: boolean;
  offsetX: number;
  offsetY: number;
  properties?: MapObjectProperty[];
}

/** A tileset referenced by the map, in the format-agnostic view. */
export interface TilesetInfo {
  /** First global tile ID this tileset owns. */
  firstGid: number;
  /** Tileset name, when the tileset data is available. */
  name?: string;
  properties?: MapObjectProperty[];
}

/** Objects of one class on one object layer. */
export interface MapObjectGroup {
  /** Object-layer name the objects came from. */
  layer: string;
  /** Tiled class, or `undefined` for objects authored without one. */
  class?: string;
  objects: MapObject[];
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
