import { CompositeTilemap } from "@pixi/tilemap";
import { Assets, Texture, Rectangle } from "pixi.js";
import type {
  TiledMapData,
  TileLayer,
  TilesetRef,
  ObjectGroup,
  TileObject,
} from "./types.js";
import type {
  TilemapData,
  TileLayerData,
  ObjectLayerData,
  MapObject,
} from "../types.js";

// ─── Generic adapter ────────────────────────────────────────────────

/**
 * Convert Tiled JSON data to the generic TilemapData format.
 */
export function toTilemapData(map: TiledMapData): TilemapData {
  const tileLayers: TileLayerData[] = [];
  const objectLayers: ObjectLayerData[] = [];

  for (const layer of map.layers) {
    if (layer.type === "tilelayer") {
      tileLayers.push({
        name: layer.name,
        data: layer.data,
        width: layer.width,
        height: layer.height,
        visible: layer.visible,
      });
    } else if (layer.type === "objectgroup") {
      objectLayers.push({
        name: layer.name,
        objects: layer.objects.map(tiledObjectToMapObject),
        visible: layer.visible,
      });
    }
  }

  return {
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    tileLayers,
    objectLayers,
  };
}

function tiledObjectToMapObject(obj: TileObject): MapObject {
  return {
    id: obj.id,
    name: obj.name,
    class: obj.class ?? obj.type,
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
    rotation: obj.rotation,
    visible: obj.visible,
    point: obj.point === true ? true : undefined,
    polygon: obj.polygon ?? undefined,
    properties: obj.properties?.map((p) => ({
      name: p.name,
      type: p.type,
      value: p.value,
    })),
  };
}

// ─── Tiled-specific rendering ───────────────────────────────────────

/**
 * Resolve the tileset that owns a given global tile ID.
 * Tilesets are sorted by firstgid; we find the last tileset whose firstgid <= gid.
 */
function findTileset(tilesets: TilesetRef[], gid: number): TilesetRef | null {
  let result: TilesetRef | null = null;
  for (const ts of tilesets) {
    if (ts.firstgid <= gid) {
      if (!result || ts.firstgid > result.firstgid) {
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
  tileset: TilesetRef,
): Texture | null {
  const data = tileset.data;
  if (!data) return null;
  const localId = gid - tileset.firstgid;

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

  if (data.image) {
    // Single-image tileset: sub-textures were created by the loader
    const cacheKey = `${data.name}:${localId}`;
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

  return null;
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

  return filtered.map((layer) => {
    const tilemap = new CompositeTilemap();
    const { data, width } = layer;

    for (let index = 0; index < data.length; index++) {
      const gid = data[index]!;
      if (gid === 0) continue;

      const tileset = findTileset(map.tilesets, gid);
      if (!tileset) {
        throw new Error(`No tileset found for tile GID ${gid}`);
      }

      const texture = resolveTileTexture(gid, tileset);
      if (!texture) {
        throw new Error(
          `Could not resolve texture for tile GID ${gid} in tileset "${tileset.data?.name}"`,
        );
      }

      const x = index % width;
      const y = Math.floor(index / width);
      tilemap.tile(texture, x * map.tilewidth, y * map.tileheight);
    }

    return tilemap;
  });
}

/**
 * Extract objects from Tiled object layers, grouped by class/type/name.
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
