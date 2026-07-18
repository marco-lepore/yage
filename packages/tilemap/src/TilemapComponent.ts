import { Component, Transform, serializable } from "@yagejs/core";
import type { AssetHandle } from "@yagejs/core";
import { Assets, Container } from "pixi.js";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type { DisplayContainer } from "@yagejs/renderer";
import { createTilemapLayers, toTilemapData } from "./tiled/parseTiledMap.js";
import { extractCollisionShapes } from "./colliders.js";
import { tiledObjectKey } from "./keys.js";
import {
  getProperty,
  getPropertyArray,
  resolveObjectRef,
  resolveObjectRefArray,
} from "./properties.js";
import type { TiledMapData } from "./tiled/types.js";
import type {
  TilemapData,
  MapObject,
  TilemapColliderConfig,
} from "./types.js";

/** Options for creating a TilemapComponent. */
export interface TilemapComponentOptions {
  /** Asset handle for the map. Preferred — captures both the parsed data and the asset path. */
  source?: AssetHandle<TiledMapData>;
  /** Parsed Tiled map data. Use only when you don't have an AssetHandle. Save/load and auto-keys require `mapKey` or `source`. */
  map?: TiledMapData;
  /** Asset path to the Tiled JSON. Resolved via `Assets.get`. Save/load uses this. */
  mapKey?: string;
  /** Which tile layers to render. Omit to render all. */
  layers?: string[];
  /** Render layer name. Default: "default". */
  layer?: string;
  /**
   * Override prefix used when auto-keying entities spawned from Tiled objects.
   * Defaults to `mapKey`. Set this when multiple instances of the same map need
   * distinct entity-key namespaces (e.g. instanced dungeons).
   */
  keyPrefix?: string;
}

/** Serializable snapshot of a TilemapComponent. */
export interface TilemapComponentData {
  mapKey: string;
  layers?: string[];
  layer: string;
  keyPrefix?: string;
}

/** Component that renders a Tiled map using @pixi/tilemap. */
@serializable
export class TilemapComponent extends Component {
  static restorePriority = 50;

  readonly container: DisplayContainer;
  readonly data: TilemapData;
  /** Asset path of this map, or `null` if constructed from a raw `TiledMapData` without one. */
  readonly mapKey: string | null;
  /** Prefix used to derive auto-keys for entities spawned from objects. */
  readonly keyPrefix: string | null;
  private readonly _tiledMap: TiledMapData;
  private readonly layerNames: string[] | undefined;
  private readonly renderLayerName: string;
  private readonly _explicitKeyPrefix: string | undefined;
  /** Lazy flat-list cache. The parsed map is treated as immutable post-construction; if that ever changes, callers must invalidate. */
  private _allObjectsCache: MapObject[] | undefined;

  constructor(options: TilemapComponentOptions) {
    super();

    const sourceCount =
      (options.source ? 1 : 0) +
      (options.map ? 1 : 0) +
      (options.mapKey ? 1 : 0);
    if (sourceCount === 0) {
      throw new Error(
        "TilemapComponent requires one of `source`, `map`, or `mapKey`.",
      );
    }

    if (options.source) {
      this.mapKey = options.source.path;
      const data = Assets.get<TiledMapData>(options.source.path);
      if (!data) {
        throw new Error(
          `TilemapComponent: source "${options.source.path}" is not loaded. Add it to scene preload.`,
        );
      }
      this._tiledMap = data;
    } else if (options.mapKey) {
      this.mapKey = options.mapKey;
      const data = Assets.get<TiledMapData>(options.mapKey);
      if (!data) {
        throw new Error(
          `TilemapComponent: map "${options.mapKey}" is not loaded. Add it to scene preload.`,
        );
      }
      this._tiledMap = data;
    } else {
      this.mapKey = null;
      this._tiledMap = options.map!;
    }

    this.data = toTilemapData(this._tiledMap);
    this.layerNames = options.layers;
    this.renderLayerName = options.layer ?? "default";
    this._explicitKeyPrefix = options.keyPrefix;
    this.keyPrefix = options.keyPrefix ?? this.mapKey;
    this.container = new Container();
  }

  onAdd(): void {
    const tilemapLayers = createTilemapLayers(this._tiledMap, this.layerNames);
    for (const layer of tilemapLayers) {
      this.container.addChild(layer);
    }

    const renderLayer = this.use(SceneRenderTreeKey).get(this.renderLayerName);
    renderLayer.container.addChild(this.container);
  }

  onDestroy(): void {
    this.container.removeFromParent();
    this.container.destroy({ children: true });
  }

  serialize(): TilemapComponentData | null {
    if (!this.mapKey) {
      console.warn(
        `TilemapComponent on "${this.entity?.name}": created with a TiledMapData object. ` +
          `Use { source } or { mapKey } for save/load support.`,
      );
      return null;
    }
    return {
      mapKey: this.mapKey,
      layer: this.renderLayerName,
      ...(this.layerNames && { layers: this.layerNames }),
      ...(this._explicitKeyPrefix !== undefined && {
        keyPrefix: this._explicitKeyPrefix,
      }),
    };
  }

  static fromSnapshot(data: TilemapComponentData): TilemapComponent {
    return new TilemapComponent({
      mapKey: data.mapKey,
      layer: data.layer,
      ...(data.layers && { layers: data.layers }),
      ...(data.keyPrefix !== undefined && { keyPrefix: data.keyPrefix }),
    });
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
  getCollisionShapes(objectLayerName?: string): TilemapColliderConfig[] {
    return extractCollisionShapes(this.data, objectLayerName);
  }

  /** Objects from object layers grouped by `class ?? name`. Use a layer name to scope. */
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

  /** Flat list of every object across every object layer. Memoized — safe because parsed map data is immutable post-construction. */
  getAllObjects(): MapObject[] {
    if (this._allObjectsCache) return this._allObjectsCache;
    const result: MapObject[] = [];
    for (const layer of this.data.objectLayers) {
      for (const obj of layer.objects) result.push(obj);
    }
    this._allObjectsCache = result;
    return result;
  }

  /**
   * Iterate every object on the given layer (or every layer if omitted),
   * passing the auto-derived stable key alongside each object so callers can
   * spawn entities with `scene.spawn(Class, params, { key })`.
   *
   * Skips objects that don't have a key prefix (component constructed from raw
   * `map:` without `mapKey` or `keyPrefix`) — those callers should iterate
   * `getObjects` directly.
   */
  forEachObject(
    layerName: string | undefined,
    fn: (obj: MapObject, key: string) => void,
  ): void {
    if (this.keyPrefix === null) {
      throw new Error(
        "TilemapComponent.forEachObject: cannot derive auto-keys without a `mapKey`, `source`, or explicit `keyPrefix`.",
      );
    }
    const layers = layerName
      ? this.data.objectLayers.filter((l) => l.name === layerName)
      : this.data.objectLayers;
    for (const layer of layers) {
      for (const obj of layer.objects) {
        fn(obj, tiledObjectKey(this.keyPrefix, obj.id));
      }
    }
  }

  /** Auto-derived stable key for an object: `<keyPrefix>#object:<id>`. */
  objectKey(obj: MapObject): string {
    if (this.keyPrefix === null) {
      throw new Error(
        "TilemapComponent.objectKey: cannot derive a key without a `mapKey`, `source`, or explicit `keyPrefix`.",
      );
    }
    return tiledObjectKey(this.keyPrefix, obj.id);
  }

  /** Find an object by its Tiled `id`. Searches every object layer. */
  findObject(id: number): MapObject | undefined {
    for (const layer of this.data.objectLayers) {
      for (const obj of layer.objects) {
        if (obj.id === id) return obj;
      }
    }
    return undefined;
  }

  /** Find the first object with a matching `name`. Searches every object layer. */
  findObjectByName(name: string): MapObject | undefined {
    for (const layer of this.data.objectLayers) {
      for (const obj of layer.objects) {
        if (obj.name === name) return obj;
      }
    }
    return undefined;
  }

  /** Read a typed custom property off any tilemap object. */
  getProperty<T = unknown>(obj: MapObject, name: string): T | undefined {
    return getProperty<T>(obj, name);
  }

  /** Read an indexed property bag (`name[0]`, `name[1]`, ...) as an array. */
  getPropertyArray<T = unknown>(obj: MapObject, name: string): T[] {
    return getPropertyArray<T>(obj, name);
  }

  /**
   * Resolve a Tiled object-reference property to the actual object.
   * Auto-collects across every layer so callers don't have to.
   */
  resolveRef(obj: MapObject, propName: string): MapObject | undefined {
    return resolveObjectRef(obj, propName, this.getAllObjects());
  }

  /** Same as `resolveRef`, but for indexed object-reference arrays. */
  resolveRefArray(obj: MapObject, propName: string): MapObject[] {
    return resolveObjectRefArray(obj, propName, this.getAllObjects());
  }
}
