import { Component, Transform } from "@yage/core";
import { Container } from "pixi.js";
import { RenderLayerManagerKey } from "@yage/renderer";
import { createTilemapLayers } from "./tiled/parseTiledMap.js";
import { toTilemapData } from "./tiled/parseTiledMap.js";
import { extractCollisionShapes } from "./colliders.js";
import type { TiledMapData } from "./tiled/types.js";
import type {
  TilemapData,
  TileLayerData,
  MapObject,
  ColliderConfig,
} from "./types.js";

/** Options for creating a TilemapComponent. */
export interface TilemapComponentOptions {
  /** Parsed Tiled map data (with resolved tilesets). */
  map: TiledMapData;
  /** Which tile layers to render. Omit to render all. */
  layers?: string[];
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Component that renders a Tiled map using @pixi/tilemap. */
export class TilemapComponent extends Component {
  readonly container: Container;
  readonly data: TilemapData;
  private readonly _tiledMap: TiledMapData;
  private readonly layerNames: string[] | undefined;
  private readonly renderLayerName: string;

  constructor(options: TilemapComponentOptions) {
    super();
    this._tiledMap = options.map;
    this.data = toTilemapData(options.map);
    this.layerNames = options.layers;
    this.renderLayerName = options.layer ?? "default";
    this.container = new Container();
  }

  onAdd(): void {
    const tilemapLayers = createTilemapLayers(this._tiledMap, this.layerNames);
    for (const layer of tilemapLayers) {
      this.container.addChild(layer);
    }

    const layers = this.use(RenderLayerManagerKey);
    const renderLayer = layers.get(this.renderLayerName);
    renderLayer.container.addChild(this.container);
  }

  onDestroy(): void {
    this.container.removeFromParent();
    this.container.destroy({ children: true });
  }

  /** Map width in pixels. */
  get widthPx(): number {
    return this.data.width * this.data.tileWidth;
  }

  /** Map height in pixels. */
  get heightPx(): number {
    return this.data.height * this.data.tileHeight;
  }

  /** Tile width in pixels. */
  get tileWidth(): number {
    return this.data.tileWidth;
  }

  /** Tile height in pixels. */
  get tileHeight(): number {
    return this.data.tileHeight;
  }

  /**
   * Returns the tile GID at a world position, accounting for entity Transform offset.
   * Returns null if the position is outside the map or the tile is empty.
   */
  getTileAt(
    worldX: number,
    worldY: number,
    layerName?: string,
  ): number | null {
    const transform = this.entity.tryGet(Transform);
    const offsetX = transform ? transform.position.x : 0;
    const offsetY = transform ? transform.position.y : 0;
    const localX = worldX - offsetX;
    const localY = worldY - offsetY;

    const col = Math.floor(localX / this.data.tileWidth);
    const row = Math.floor(localY / this.data.tileHeight);

    if (col < 0 || col >= this.data.width) return null;
    if (row < 0 || row >= this.data.height) return null;

    const layers = layerName
      ? this.data.tileLayers.filter((l) => l.name === layerName)
      : this.data.tileLayers;

    // Return first non-zero GID found (from last layer to first for top-most)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const gid = layer.data[row * layer.width + col];
      if (gid !== undefined && gid !== 0) return gid;
    }

    return null;
  }

  /** Extract physics-agnostic collision shapes from object layers. */
  getCollisionShapes(objectLayerName?: string): ColliderConfig[] {
    return extractCollisionShapes(this.data, objectLayerName);
  }

  /** Extract objects from object layers grouped by class/name. */
  getObjects(objectLayerName?: string): Record<string, MapObject[]> {
    const filtered = objectLayerName
      ? this.data.objectLayers.filter((l) => l.name === objectLayerName)
      : this.data.objectLayers;

    const result: Record<string, MapObject[]> = {};

    for (const layer of filtered) {
      for (const obj of layer.objects) {
        const key = obj.class ?? obj.name;
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(obj);
      }
    }

    return result;
  }

  /**
   * @deprecated Use `data` instead.
   */
  get mapData(): TiledMapData {
    return this._tiledMap;
  }
}
