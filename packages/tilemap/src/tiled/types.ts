// ─── Tiled JSON Data Types ──────────────────────────────────────────

export interface TiledMapData {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: (TileLayer | ObjectGroup)[];
  tilesets: TilesetRef[];
  orientation?: string;
  renderorder?: string;
  infinite?: boolean;
  nextlayerid?: number;
  nextobjectid?: number;
  tiledversion?: string;
  type?: string;
  version?: string | number;
}

export interface TileLayer {
  type: "tilelayer";
  data: number[];
  width: number;
  height: number;
  id: number;
  name: string;
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
}

export interface ObjectGroup {
  type: "objectgroup";
  id: number;
  name: string;
  objects: TileObject[];
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
  draworder?: string;
}

export interface RectangleObject {
  id: number;
  name: string;
  class?: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: undefined | false;
  polygon?: undefined;
  properties?: TileObjectProperty[];
}

export interface PolygonObject {
  id: number;
  name: string;
  class?: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: undefined | false;
  polygon: { x: number; y: number }[];
  properties?: TileObjectProperty[];
}

export interface PointObject {
  id: number;
  name: string;
  class?: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point: true;
  polygon?: undefined;
  properties?: TileObjectProperty[];
}

export type TileObject = RectangleObject | PointObject | PolygonObject;

export interface TileObjectProperty {
  name: string;
  type: string;
  value: unknown;
}

export interface TilesetRef {
  firstgid: number;
  source?: string;
  /** Resolved tileset data — populated by the loader. */
  data?: TilesetData;
}

export interface TilesetData {
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin?: number;
  spacing?: number;
  /** Single-image tileset: path to the spritesheet image. */
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  /** Collection-of-images tileset: individual tile metadata. */
  tiles?: TileData[];
  tiledversion?: string;
  type?: string;
  version?: string | number;
}

export interface TileData {
  id: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
}
