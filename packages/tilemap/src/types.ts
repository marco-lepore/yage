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

export interface RectColliderConfig {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonColliderConfig {
  type: "polygon";
  x: number;
  y: number;
  vertices: { x: number; y: number }[];
}

export type TilemapColliderConfig = RectColliderConfig | PolygonColliderConfig;
