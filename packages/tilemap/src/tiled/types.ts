// ─── Tiled JSON Data Types ──────────────────────────────────────────

export interface TiledMapData {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TilesetRef[];
  properties?: TileObjectProperty[];
  orientation?: string;
  renderorder?: string;
  infinite?: boolean;
  nextlayerid?: number;
  nextobjectid?: number;
  tiledversion?: string;
  type?: string;
  version?: string | number;
}

export type TiledLayer = TileLayer | ObjectGroup | GroupLayer | ImageLayer;

export interface TileLayer {
  type: "tilelayer";
  data?: number[] | string;
  width: number;
  height: number;
  id: number;
  name: string;
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
  offsetx?: number;
  offsety?: number;
  encoding?: string;
  compression?: string;
  chunks?: TileChunk[];
  parallaxx?: number;
  parallaxy?: number;
  properties?: TileObjectProperty[];
}

export interface TileChunk {
  data: number[] | string;
  width: number;
  height: number;
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
  offsetx?: number;
  offsety?: number;
  draworder?: string;
  properties?: TileObjectProperty[];
}

export interface GroupLayer {
  type: "group";
  id: number;
  name: string;
  layers: TiledLayer[];
  opacity?: number;
  visible?: boolean;
  x?: number;
  y?: number;
  offsetx?: number;
  offsety?: number;
  parallaxx?: number;
  parallaxy?: number;
}

export interface ImageLayer {
  type: "imagelayer";
  id: number;
  name: string;
  image?: string;
  opacity?: number;
  visible?: boolean;
  x?: number;
  y?: number;
  offsetx?: number;
  offsety?: number;
  parallaxx?: number;
  parallaxy?: number;
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
  /**
   * Global tile ID, present only on an object that draws a tile. Tiled anchors
   * such an object at its bottom-left corner, so `y` is its bottom edge while
   * every other object measures `y` from its top. The flip bits are kept —
   * split them out with `readTileGid`.
   */
  gid?: number;
  point?: undefined | false;
  polygon?: undefined;
  polyline?: undefined;
  ellipse?: undefined | false;
  capsule?: undefined | false;
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
  gid?: undefined;
  point?: undefined | false;
  polygon: { x: number; y: number }[];
  polyline?: undefined;
  ellipse?: undefined | false;
  capsule?: undefined | false;
  properties?: TileObjectProperty[];
}

export interface PolylineObject {
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
  polyline: { x: number; y: number }[];
  gid?: undefined;
  ellipse?: undefined | false;
  capsule?: undefined | false;
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
  gid?: undefined;
  point: true;
  polygon?: undefined;
  polyline?: undefined;
  ellipse?: undefined | false;
  capsule?: undefined | false;
  properties?: TileObjectProperty[];
}

export interface EllipseObject {
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
  gid?: undefined;
  ellipse: true;
  point?: undefined | false;
  polygon?: undefined;
  polyline?: undefined;
  capsule?: undefined | false;
  properties?: TileObjectProperty[];
}

export interface CapsuleObject {
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
  gid?: undefined;
  capsule: true;
  point?: undefined | false;
  polygon?: undefined;
  polyline?: undefined;
  ellipse?: undefined | false;
  properties?: TileObjectProperty[];
}

export type TileObject =
  | RectangleObject
  | PointObject
  | PolygonObject
  | PolylineObject
  | EllipseObject
  | CapsuleObject;

export interface TileObjectProperty {
  name: string;
  type: string;
  value: unknown;
}

export interface TilesetRef extends Partial<TilesetData> {
  firstgid: number;
  /** External tileset JSON path. Absent for an embedded tileset. */
  source?: string;
  /** Resolved tileset data — the loader fills this for both forms. */
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
  properties?: TileObjectProperty[];
  tileoffset?: { x: number; y: number };
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
  animation?: TileAnimationFrame[];
}

export interface TileAnimationFrame {
  tileid: number;
  duration: number;
}
