import { CompositeTilemap } from "@pixi/tilemap";
import { Assets, Texture, Rectangle } from "pixi.js";
import type {
  TiledMapData,
  TileLayer,
  TilesetData,
  TilesetRef,
  ObjectGroup,
  TileObject,
  TileObjectProperty,
} from "./types.js";
import type {
  TilemapData,
  TileLayerData,
  ObjectLayerData,
  MapObject,
  MapObjectProperty,
} from "../types.js";
import { subtextureCacheKey } from "./cacheKey.js";
import { readTileAnimation } from "./animation.js";
import type { TileAnimationSupport } from "./animation.js";
import { validateTiledMap } from "./diagnostics.js";
import { tileIdFromGid, tileRotationFromGid } from "./gid.js";
import { resolveTilesetData } from "./resolveTilesetData.js";

/** Objects of one class on one raw Tiled object layer. */
export interface TiledObjectGroup {
  /** Object-layer name the objects came from. */
  layer: string;
  /** Tiled class/type, or `undefined` when the objects have neither. */
  class?: string;
  objects: TileObject[];
}

function copyProperties(properties: TileObjectProperty[]): MapObjectProperty[] {
  return properties.map((property) => ({
    name: property.name,
    type: property.type,
    value: property.value,
  }));
}

// ─── Generic adapter ────────────────────────────────────────────────

/**
 * Convert Tiled JSON data to the generic TilemapData format.
 */
export function toTilemapData(map: TiledMapData): TilemapData {
  const tileLayers: TileLayerData[] = [];
  const objectLayers: ObjectLayerData[] = [];

  for (const layer of map.layers) {
    if (layer.type === "tilelayer") {
      const offsetX = layer.offsetx ?? 0;
      const offsetY = layer.offsety ?? 0;
      tileLayers.push({
        name: layer.name,
        data: Array.isArray(layer.data) ? layer.data : [],
        width: layer.width,
        height: layer.height,
        visible: layer.visible,
        offsetX,
        offsetY,
        ...(layer.properties !== undefined && {
          properties: copyProperties(layer.properties),
        }),
      });
    } else if (layer.type === "objectgroup") {
      const offsetX = layer.offsetx ?? 0;
      const offsetY = layer.offsety ?? 0;
      objectLayers.push({
        name: layer.name,
        objects: layer.objects.map((object) =>
          tiledObjectToMapObject(object, offsetX, offsetY),
        ),
        visible: layer.visible,
        offsetX,
        offsetY,
        ...(layer.properties !== undefined && {
          properties: copyProperties(layer.properties),
        }),
      });
    }
  }

  const tilesets = map.tilesets.map((ref) => {
    const data = resolveTilesetData(ref);
    return {
      firstGid: ref.firstgid,
      ...(data !== null && { name: data.name }),
      ...(data?.properties !== undefined && {
        properties: copyProperties(data.properties),
      }),
    };
  });

  return {
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    ...(map.properties !== undefined && {
      properties: copyProperties(map.properties),
    }),
    tileLayers,
    objectLayers,
    tilesets,
    diagnostics: validateTiledMap(map),
  };
}

function tiledObjectToMapObject(
  obj: TileObject,
  offsetX = 0,
  offsetY = 0,
): MapObject {
  const result: MapObject = {
    id: obj.id,
    name: obj.name,
    x: obj.x + offsetX,
    y: obj.y + offsetY,
    width: obj.width,
    height: obj.height,
    rotation: obj.rotation,
    visible: obj.visible,
  };

  const cls = obj.class ?? obj.type;
  if (cls) result.class = cls;
  if (obj.point === true) result.point = true;
  if (obj.polygon) result.polygon = obj.polygon;
  if (obj.polyline) result.polyline = obj.polyline;
  if (obj.ellipse === true) result.ellipse = true;
  if (obj.capsule === true) result.capsule = true;
  if (obj.properties) {
    result.properties = copyProperties(obj.properties);
  }

  return result;
}

// ─── Tiled-specific rendering ───────────────────────────────────────

/**
 * Resolve the tileset that owns a given global tile ID.
 * Tilesets are sorted by firstgid; we find the last tileset whose firstgid <= gid.
 */
interface TilesetMatch {
  ref: TilesetRef;
  data: TilesetData | null;
}

type TileAnimationCache = Map<
  TilesetData,
  Map<number, TileAnimationSupport | null>
>;

const animatedTilemapLayers = new WeakSet<object>();

/** @internal */
export function _tilemapLayerHasAnimation(layer: object): boolean {
  return animatedTilemapLayers.has(layer);
}

function findTileset(tilesets: TilesetMatch[], gid: number): TilesetMatch | null {
  let result: TilesetMatch | null = null;
  for (const ts of tilesets) {
    if (ts.ref.firstgid <= gid) {
      if (!result || ts.ref.firstgid > result.ref.firstgid) {
        result = ts;
      }
    }
  }
  return result;
}

/**
 * Resolve the texture for a tile given its GID and owning tileset.
 */
function resolveTileTexture(
  gid: number,
  tileset: TilesetMatch,
): Texture | null {
  const data = tileset.data;
  if (!data) return null;
  const localId = gid - tileset.ref.firstgid;

  // `image` is what distinguishes the two tileset forms. A single-image
  // tileset also carries `tiles[]` as soon as one tile has an animation,
  // class, custom property or collision shape, so the presence of that array
  // says nothing about which form this is.
  if (data.image) {
    // Single-image tileset: sub-textures were created by the loader
    const cacheKey = subtextureCacheKey(data.image, localId);
    const tex = Assets.get<Texture>(cacheKey);
    if (tex) return tex;

    // Fallback: create sub-texture on the fly from the base image
    const filenameMatch = data.image.match(/[^/]*$/);
    const filename = filenameMatch?.[0];
    if (!filename) return null;
    const baseTex = Assets.get<Texture>(filename);
    if (!baseTex) return null;

    const cols = data.columns;
    const tw = data.tilewidth;
    const th = data.tileheight;
    const margin = data.margin ?? 0;
    const spacing = data.spacing ?? 0;
    const col = localId % cols;
    const row = Math.floor(localId / cols);
    const x = margin + col * (tw + spacing);
    const y = margin + row * (th + spacing);

    return new Texture({
      source: baseTex.source,
      frame: new Rectangle(x, y, tw, th),
    });
  }

  if (data.tiles?.length) {
    // Collection-of-images tileset: look up texture by filename from cache
    const tileData = data.tiles[localId];
    if (!tileData?.image) return null;
    const filenameMatch = tileData.image.match(/[^/]*$/);
    const filename = filenameMatch?.[0];
    if (!filename) return null;
    const tex = Assets.get<Texture>(filename);
    return tex ?? null;
  }

  return null;
}

function tilesetLabel(tileset: TilesetMatch): string {
  return (
    tileset.data?.name ??
    tileset.ref.source ??
    `firstgid ${tileset.ref.firstgid}`
  );
}

function cachedTileAnimation(
  cache: TileAnimationCache,
  tileset: TilesetData,
  localId: number,
): TileAnimationSupport | null {
  let byTileId = cache.get(tileset);
  if (!byTileId) {
    byTileId = new Map();
    cache.set(tileset, byTileId);
  }
  if (byTileId.has(localId)) return byTileId.get(localId) ?? null;

  const result = readTileAnimation(tileset, localId);
  byTileId.set(localId, result);
  return result;
}

/**
 * Build CompositeTilemap display objects from a parsed Tiled map.
 *
 * @param map - Parsed TiledMapData (with resolved tilesets).
 * @param layerNames - Optional filter: only process these tile layer names.
 * @returns Array of CompositeTilemap, one per tile layer.
 */
export function createTilemapLayers(
  map: TiledMapData,
  layerNames?: string[],
): CompositeTilemap[] {
  const tileLayers = map.layers.filter(
    (l): l is TileLayer => l.type === "tilelayer",
  );

  const filtered = layerNames
    ? tileLayers.filter((l) => layerNames.includes(l.name))
    : tileLayers;

  // Resolve each tileset once. An embedded tileset that never went through
  // the loader is rebuilt on every call, so resolving per tile would copy it
  // once per drawn tile.
  const tilesets = map.tilesets.map((ref) => ({
    ref,
    data: resolveTilesetData(ref),
  }));
  const animationCache: TileAnimationCache = new Map();

  return filtered.map((layer) => {
    const tilemap = new CompositeTilemap();
    let hasAnimatedTile = false;
    tilemap.visible = layer.visible;
    const data = Array.isArray(layer.data) ? layer.data : [];
    const { width } = layer;

    for (let index = 0; index < data.length; index++) {
      const rawGid = data[index]!;
      // Tiled keeps flip and rotation in a GID's high bits; everything that
      // looks a tile up wants the id alone.
      const gid = tileIdFromGid(rawGid);
      if (gid === 0) continue;

      const tileset = findTileset(tilesets, gid);
      if (!tileset) {
        throw new Error(`No tileset found for tile GID ${gid}`);
      }

      const localId = gid - tileset.ref.firstgid;
      const animationSupport = tileset.data
        ? cachedTileAnimation(animationCache, tileset.data, localId)
        : null;
      const animation =
        animationSupport?.supported === true
          ? animationSupport.animation
          : undefined;
      if (animation) hasAnimatedTile = true;

      // An animated tile is drawn with its first frame's image, because the
      // shader steps forward from whatever image the tile carries. Tiled lets
      // the animation live on a different tile than the one it starts on.
      const textureGid = animation
        ? tileset.ref.firstgid + animation.firstFrameId
        : gid;
      const texture = resolveTileTexture(textureGid, tileset);
      if (!texture) {
        throw new Error(
          `Could not resolve texture for tile GID ${textureGid} in tileset "${tilesetLabel(tileset)}"`,
        );
      }

      const x = index % width;
      const y = Math.floor(index / width);
      const tileOffset = tileset.data?.tileoffset;
      const rotate = tileRotationFromGid(rawGid);
      // The tilemap shader reads a per-tile alpha attribute and ignores the
      // container's, so layer opacity has to be baked into each tile.
      tilemap.tile(
        texture,
        x * map.tilewidth + (layer.offsetx ?? 0) + (tileOffset?.x ?? 0),
        y * map.tileheight + (layer.offsety ?? 0) + (tileOffset?.y ?? 0),
        {
          alpha: layer.opacity,
          rotate,
          ...(animation !== undefined && {
            animX: animation.strideX,
            animY: animation.strideY,
            animCountX: animation.frameCount,
            animCountY: animation.frameCount,
            animDivisor: animation.frameDurationMs,
          }),
        },
      );
    }

    if (hasAnimatedTile) animatedTilemapLayers.add(tilemap);

    return tilemap;
  });
}

/**
 * Extract objects from Tiled object layers, grouped by class/type/name.
 * Use {@link extractObjectGroups} when the source layer must be preserved.
 * Returned objects keep their raw Tiled coordinates without layer offsets.
 *
 * @param map - Parsed TiledMapData.
 * @param objectLayerName - Optional: only extract from this layer.
 * @returns Record mapping class/type/name to arrays of TileObject.
 */
export function extractObjects(
  map: TiledMapData,
  objectLayerName?: string,
): Record<string, TileObject[]> {
  const objectLayers = map.layers.filter(
    (l): l is ObjectGroup => l.type === "objectgroup",
  );

  const filtered = objectLayerName
    ? objectLayers.filter((l) => l.name === objectLayerName)
    : objectLayers;

  const result: Record<string, TileObject[]> = {};

  for (const layer of filtered) {
    for (const obj of layer.objects) {
      const key = obj.class ?? obj.type ?? obj.name;
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push(obj);
    }
  }

  return result;
}

/**
 * Extract raw Tiled objects grouped strictly by object layer and class/type.
 * Returned objects keep their raw Tiled coordinates without layer offsets.
 */
export function extractObjectGroups(
  map: TiledMapData,
  objectLayerName?: string,
): TiledObjectGroup[] {
  const objectLayers = map.layers.filter(
    (layer): layer is ObjectGroup => layer.type === "objectgroup",
  );
  const filtered = objectLayerName
    ? objectLayers.filter((layer) => layer.name === objectLayerName)
    : objectLayers;
  const result: TiledObjectGroup[] = [];

  for (const layer of filtered) {
    const groups = new Map<string | undefined, TileObject[]>();
    for (const object of layer.objects) {
      const objectClass = object.class ?? object.type;
      const objects = groups.get(objectClass);
      if (objects) {
        objects.push(object);
      } else {
        groups.set(objectClass, [object]);
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
