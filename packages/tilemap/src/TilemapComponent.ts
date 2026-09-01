import { Transform } from "@yagejs/core";
import type { AssetHandle } from "@yagejs/core";
import type { CompositeTilemap } from "@pixi/tilemap";
import { Assets, ColorMatrixFilter, Container } from "pixi.js";
import { VisualComponent } from "@yagejs/renderer";
import type {
  ColorValue,
  DestroyOptions,
  DisplayContainer,
  Filter,
  VisualComponentOptions,
} from "@yagejs/renderer";
import {
  _tilemapLayerHasAnimation,
  createTilemapLayers,
  toTilemapData,
} from "./tiled/parseTiledMap.js";
import { tileIdFromGid } from "./tiled/gid.js";
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
  HasProperties,
  MapObject,
  MapObjectGroup,
  TilemapColliderConfig,
} from "./types.js";

/** Options for creating a TilemapComponent. */
export interface TilemapComponentOptions extends VisualComponentOptions {
  /** Asset handle for the map. Preferred — captures both the parsed data and the asset path. */
  source?: AssetHandle<TiledMapData>;
  /** Parsed Tiled map data. Use only when you don't have an AssetHandle. Auto-keys require `mapKey` or `source`. */
  map?: TiledMapData;
  /** Asset path to the Tiled JSON. Resolved via `Assets.get`. */
  mapKey?: string;
  /** Which tile layers to render. Omit to render all. */
  layers?: string[];
  /**
   * Override prefix used when auto-keying entities spawned from Tiled objects.
   * Defaults to `mapKey`. Set this when multiple instances of the same map need
   * distinct entity-key namespaces (e.g. instanced dungeons).
   */
  keyPrefix?: string;
}

/** Component that renders a Tiled map using @pixi/tilemap. */
export class TilemapComponent extends VisualComponent {
  readonly container: DisplayContainer;
  readonly data: TilemapData;
  /** Asset path of this map, or `null` if constructed from a raw `TiledMapData` without one. */
  readonly mapKey: string | null;
  /** Prefix used to derive auto-keys for entities spawned from objects. */
  readonly keyPrefix: string | null;
  private readonly _tiledMap: TiledMapData;
  private readonly layerNames: string[] | undefined;
  private _tilemapLayers: CompositeTilemap[] = [];
  private _hasAnimatedTiles = false;
  private _animationTimeMs = 0;
  private _colorFilter: ColorMatrixFilter | undefined;
  /** Lazy flat-list cache. The parsed map is treated as immutable post-construction; if that ever changes, callers must invalidate. */
  private _allObjectsCache: MapObject[] | undefined;

  constructor(options: TilemapComponentOptions) {
    super(options.layer);

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
    this.keyPrefix = options.keyPrefix ?? this.mapKey;
    this.container = new Container();

    if (this.data.diagnostics.length > 0) {
      const mapLabel = this.mapKey ?? "<inline map>";
      const details = this.data.diagnostics
        .map(
          (diagnostic) =>
            `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
        )
        .join("\n");
      console.warn(`TilemapComponent "${mapLabel}" diagnostics:\n${details}`);
    }

    this.applyVisualOptions(options);
    this.syncColorFilter();
  }

  /** The underlying tilemap container. */
  get renderObject(): DisplayContainer {
    return this.container;
  }

  // The tilemap shader has no color uniform, so a filter applies tint and
  // alpha to the rendered tilemap texture.
  override set tint(color: ColorValue) {
    this.container.tint = color;
    this.syncColorFilter();
  }

  override get tint(): number {
    return this.container.tint;
  }

  protected override applyEffectiveAlpha(alpha: number): void {
    this.container.alpha = alpha;
    this.syncColorFilter();
  }

  onAdd(): void {
    this._tilemapLayers = createTilemapLayers(this._tiledMap, this.layerNames);
    this._hasAnimatedTiles = this._tilemapLayers.some(
      _tilemapLayerHasAnimation,
    );
    for (const layer of this._tilemapLayers) {
      this.container.addChild(layer);
    }
    super.onAdd();
  }

  /**
   * Advance the tile-animation clock. `ComponentUpdateSystem` supplies time
   * already scaled by the scene and the entity, and skips paused scenes, so a
   * paused game freezes its tilemaps and `timeScale` slows them.
   */
  update(deltaSeconds: number): void {
    if (!this._hasAnimatedTiles) return;

    this._animationTimeMs += deltaSeconds * 1000;
    for (const layer of this._tilemapLayers) {
      layer.tileAnim = [this._animationTimeMs, this._animationTimeMs];
    }
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
   * Returns the tile id at a world position, accounting for the entity
   * Transform and each layer's own draw offset. Returns null if the position
   * is outside every layer or the tile is empty.
   *
   * A tileset's `tileoffset` is not reversed here: it moves where a tile's
   * image is drawn, not which cell the tile occupies, and one layer can mix
   * tilesets that offset differently. So a tile from an offset tileset
   * answers at its cell, which is where its collision and neighbours are,
   * rather than under the part of the image that overhangs. A tile image
   * that does not match the grid is the same case: it sits on its cell's
   * bottom edge, and the cells its image reaches into answer with whatever
   * they hold themselves.
   *
   * Tiled's flip bits are stripped, so the id compares against a tileset's
   * numbering whichever way the tile faces. Read them from the raw layer data
   * with `readTileGid` when orientation matters.
   */
  getTileAt(worldX: number, worldY: number, layerName?: string): number | null {
    const transform = this.entity.tryGet(Transform);
    const offsetX = transform ? transform.position.x : 0;
    const offsetY = transform ? transform.position.y : 0;
    const layers = layerName
      ? this.data.tileLayers.filter((l) => l.name === layerName)
      : this.data.tileLayers;

    // Return the first non-empty tile found, from the last layer to the first
    // so the top-most one wins.
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const localX = worldX - offsetX - layer.offsetX;
      const localY = worldY - offsetY - layer.offsetY;
      const col = Math.floor(localX / this.data.tileWidth);
      const row = Math.floor(localY / this.data.tileHeight);

      if (col < 0 || col >= layer.width) continue;
      if (row < 0 || row >= layer.height) continue;

      const gid = layer.data[row * layer.width + col];
      if (gid === undefined) continue;
      const id = tileIdFromGid(gid);
      if (id !== 0) return id;
    }

    return null;
  }

  /** Extract physics-agnostic collision shapes from object layers. */
  getCollisionShapes(objectLayerName?: string): TilemapColliderConfig[] {
    return extractCollisionShapes(this.data, objectLayerName);
  }

  /**
   * Objects grouped by `class ?? name`. Use {@link getObjectGroups} when the
   * source layer must be preserved.
   */
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

  /** Objects grouped strictly by object layer and class. */
  getObjectGroups(objectLayerName?: string): MapObjectGroup[] {
    const layers = objectLayerName
      ? this.data.objectLayers.filter((layer) => layer.name === objectLayerName)
      : this.data.objectLayers;
    const result: MapObjectGroup[] = [];

    for (const layer of layers) {
      const groups = new Map<string | undefined, MapObject[]>();
      for (const object of layer.objects) {
        const objects = groups.get(object.class);
        if (objects) {
          objects.push(object);
        } else {
          groups.set(object.class, [object]);
        }
      }
      for (const [objectClass, objects] of groups) {
        result.push({
          layer: layer.name,
          ...(objectClass !== undefined && { class: objectClass }),
          objects,
        });
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

  /** Read a typed custom property from any tilemap data that has properties. */
  getProperty<T = unknown>(obj: HasProperties, name: string): T | undefined {
    return getProperty<T>(obj, name);
  }

  /** Read an indexed property bag (`name[0]`, `name[1]`, ...) as an array. */
  getPropertyArray<T = unknown>(obj: HasProperties, name: string): T[] {
    return getPropertyArray<T>(obj, name);
  }

  /**
   * Resolve a Tiled object-reference property to the actual object.
   * Auto-collects across every layer so callers don't have to.
   */
  resolveRef(obj: HasProperties, propName: string): MapObject | undefined {
    return resolveObjectRef(obj, propName, this.getAllObjects());
  }

  /** Same as `resolveRef`, but for indexed object-reference arrays. */
  resolveRefArray(obj: HasProperties, propName: string): MapObject[] {
    return resolveObjectRefArray(obj, propName, this.getAllObjects());
  }

  protected destroyOptions(): DestroyOptions {
    return { children: true };
  }

  override onDestroy(): void {
    this.removeColorFilter();
    super.onDestroy();
  }

  private currentFilters(): Filter[] {
    const filters = this.container.filters as
      | Filter
      | readonly Filter[]
      | null
      | undefined;
    if (filters == null) return [];
    return Array.isArray(filters) ? [...filters] : [filters as Filter];
  }

  private syncColorFilter(): void {
    const tint = this.container.tint;
    const alpha = this.container.alpha;
    if (tint === 0xffffff && alpha === 1) {
      this.removeColorFilter();
      return;
    }

    const filter = this._colorFilter ?? new ColorMatrixFilter();
    this._colorFilter = filter;
    const red = ((tint >> 16) & 0xff) / 255;
    const green = ((tint >> 8) & 0xff) / 255;
    const blue = (tint & 0xff) / 255;
    filter.matrix = [
      red,
      0,
      0,
      0,
      0,
      0,
      green,
      0,
      0,
      0,
      0,
      0,
      blue,
      0,
      0,
      0,
      0,
      0,
      alpha,
      0,
    ];

    // First in the chain, so tint applies to the tilemap itself and every
    // `.fx` effect then works on the tinted result. `EffectStack` rebuilds the
    // array as [external, ...owned], which puts it first too — matching that
    // keeps the order the same however the two are interleaved.
    const filters = this.currentFilters();
    if (!filters.includes(filter)) {
      this.container.filters = [filter, ...filters];
    }
  }

  private removeColorFilter(): void {
    const filter = this._colorFilter;
    if (!filter) return;
    const filters = this.currentFilters().filter((entry) => entry !== filter);
    this.container.filters = filters.length > 0 ? filters : null;
    filter.destroy();
    this._colorFilter = undefined;
  }
}
