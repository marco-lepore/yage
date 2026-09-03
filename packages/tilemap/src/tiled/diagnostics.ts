import { resolveTilesetData } from "./resolveTilesetData.js";
import { readTileAnimation } from "./animation.js";
import { tileIdFromGid } from "./gid.js";
import { collectionTileIds, findTilesetIndexForGid } from "./tilesetRange.js";
import type { TilesetRange } from "./tilesetRange.js";
import type { TilemapDiagnostic } from "../types.js";
import type { TiledMapData, TilesetRef } from "./types.js";

/** Distinct ids an `unknown-gid` message names before it counts the rest. */
const MAX_LISTED_UNKNOWN_GIDS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordName(record: Record<string, unknown>, fallback: string): string {
  return typeof record.name === "string" ? record.name : fallback;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}

function descendantNames(layer: Record<string, unknown>): string[] {
  if (!Array.isArray(layer.layers)) return [];
  const names: string[] = [];
  for (const child of layer.layers) {
    if (!isRecord(child)) continue;
    names.push(recordName(child, "unnamed layer"));
    names.push(...descendantNames(child));
  }
  return names;
}

/**
 * Report the tiles a layer places from no tileset. Tiled writes such a gid when
 * a tileset was removed from the map without clearing the tiles that used it,
 * or when a hand-built map numbers a tile past its tileset's `tilecount`.
 */
function validateLayerGids(
  layer: Record<string, unknown>,
  name: string,
  tilesets: readonly TilesetRange[],
  diagnostics: TilemapDiagnostic[],
): void {
  const data = layer.data;
  const width = layer.width;
  if (!isNumberArray(data) || typeof width !== "number" || width <= 0) return;

  // One entry per distinct gid, at the first cell it appears in: a map that
  // lost a tileset repeats the same handful of gids across thousands of cells.
  const firstCell = new Map<number, { col: number; row: number }>();
  for (let index = 0; index < data.length; index++) {
    const gid = tileIdFromGid(data[index]!);
    if (gid === 0 || firstCell.has(gid)) continue;
    if (findTilesetIndexForGid(tilesets, gid) >= 0) continue;
    firstCell.set(gid, {
      col: index % width,
      row: Math.floor(index / width),
    });
  }
  if (firstCell.size === 0) return;

  const listed = [...firstCell]
    .slice(0, MAX_LISTED_UNKNOWN_GIDS)
    .map(([gid, cell]) => `${gid} at column ${cell.col}, row ${cell.row}`);
  const remaining = firstCell.size - listed.length;
  const summary =
    remaining > 0 ? ` …and ${remaining} more unknown tile ids.` : "";
  diagnostics.push({
    code: "unknown-gid",
    message: `Tile layer "${name}" places tiles whose ids belong to no tileset, so those cells are empty: ${listed.join("; ")}.${summary}`,
    severity: "error",
    layer: name,
  });
}

function validateLayer(
  layer: unknown,
  tilesets: readonly TilesetRange[],
  diagnostics: TilemapDiagnostic[],
): void {
  if (!isRecord(layer)) return;

  const name = recordName(layer, "unnamed layer");
  const type = layer.type;

  if (
    (layer.parallaxx !== undefined && layer.parallaxx !== 1) ||
    (layer.parallaxy !== undefined && layer.parallaxy !== 1)
  ) {
    diagnostics.push({
      code: "layer-parallax",
      message: `Layer "${name}" sets parallax, which the renderer does not apply.`,
      severity: "warning",
      layer: name,
    });
  }

  if (type === "tilelayer") {
    if (layer.chunks !== undefined) {
      diagnostics.push({
        code: "chunked-layer",
        message: `Tile layer "${name}" uses chunks, so its tile content is dropped.`,
        severity: "error",
        layer: name,
      });
    }
    if (layer.chunks === undefined && !isNumberArray(layer.data)) {
      diagnostics.push({
        code: "encoded-layer-data",
        message: `Tile layer "${name}" does not contain a flat number array, so its tile content is dropped.`,
        severity: "error",
        layer: name,
      });
    }
    validateLayerGids(layer, name, tilesets, diagnostics);
    return;
  }

  if (type === "objectgroup") {
    const tileObjects: string[] = [];
    if (Array.isArray(layer.objects)) {
      for (const object of layer.objects) {
        if (!isRecord(object) || typeof object.gid !== "number") continue;
        // Tiled writes an empty name for an unnamed object.
        const named = typeof object.name === "string" && object.name !== "";
        tileObjects.push(
          named ? String(object.name) : `object ${String(object.id)}`,
        );
      }
    }
    if (tileObjects.length > 0) {
      diagnostics.push({
        code: "tile-object",
        message: `Object layer "${name}" places tiles as objects, whose images are not drawn: ${tileObjects.join(", ")}. Their position, size, gid and custom properties are on the object layer.`,
        severity: "error",
        layer: name,
      });
    }
    return;
  }

  if (type === "group") {
    const children = descendantNames(layer);
    const childText =
      children.length > 0
        ? ` Its dropped children are: ${children.join(", ")}.`
        : "";
    diagnostics.push({
      code: "group-layer",
      message: `Group layer "${name}" is not rendered.${childText}`,
      severity: "error",
      layer: name,
    });
    if (Array.isArray(layer.layers)) {
      for (const child of layer.layers) {
        validateLayer(child, tilesets, diagnostics);
      }
    }
    return;
  }

  if (type === "imagelayer") {
    diagnostics.push({
      code: "image-layer",
      message: `Image layer "${name}" is not rendered.`,
      severity: "error",
      layer: name,
    });
  }
}

function tilesetName(ref: Record<string, unknown>): string {
  if (typeof ref.source === "string") return ref.source;
  if (typeof ref.name === "string") return ref.name;
  if (isRecord(ref.data) && typeof ref.data.name === "string") {
    return ref.data.name;
  }
  return typeof ref.firstgid === "number"
    ? `firstgid ${ref.firstgid}`
    : "unknown tileset";
}

/** Gid range of every tileset the map declares, in declaration order. */
function tilesetRanges(rawMap: Record<string, unknown>): TilesetRange[] {
  if (!Array.isArray(rawMap.tilesets)) return [];
  const ranges: TilesetRange[] = [];
  for (const value of rawMap.tilesets) {
    if (!isRecord(value) || typeof value.firstgid !== "number") continue;
    const resolved = resolveTilesetData(value as unknown as TilesetRef);
    ranges.push({
      firstgid: value.firstgid,
      ...(resolved === null
        ? {}
        : resolved.image
          ? { tilecount: resolved.tilecount }
          : { tileIds: collectionTileIds(resolved.tiles) }),
    });
  }
  return ranges;
}

/** Report the Tiled features this package does not support in a map. */
export function validateTiledMap(map: TiledMapData): TilemapDiagnostic[] {
  const diagnostics: TilemapDiagnostic[] = [];
  const rawMap = map as unknown as Record<string, unknown>;
  const tilesets = tilesetRanges(rawMap);

  if (rawMap.orientation !== undefined && rawMap.orientation !== "orthogonal") {
    diagnostics.push({
      code: "unsupported-orientation",
      message: `Map orientation "${String(rawMap.orientation)}" is not supported; tiles are rendered as orthogonal.`,
      severity: "error",
    });
  }

  if (rawMap.infinite === true) {
    diagnostics.push({
      code: "infinite-map",
      message: "The map is infinite, so chunked tile content is not rendered.",
      severity: "error",
    });
  }

  if (Array.isArray(rawMap.layers)) {
    for (const layer of rawMap.layers) {
      validateLayer(layer, tilesets, diagnostics);
    }
  }

  if (Array.isArray(rawMap.tilesets)) {
    for (const value of rawMap.tilesets) {
      if (!isRecord(value)) continue;
      const name = tilesetName(value);
      const source =
        typeof value.source === "string" ? value.source : undefined;
      if (source?.toLowerCase().endsWith(".tsx")) {
        diagnostics.push({
          code: "tsx-tileset",
          message: `Tileset "${source}" is XML, which this package does not load.`,
          severity: "error",
          tileset: source,
        });
        continue;
      }

      // An external JSON tileset the loader has not read yet is fine — it
      // resolves at load time. Only a reference that can never resolve is a
      // diagnostic.
      if (source !== undefined && value.data === undefined) continue;

      const resolved = resolveTilesetData(value as unknown as TilesetRef);
      if (!resolved) {
        diagnostics.push({
          code: "unresolved-tileset",
          message: `Tileset "${name}" has no resolved tileset data, so its tiles cannot render.`,
          severity: "error",
          tileset: name,
        });
        continue;
      }

      const unsupportedAnimations: string[] = [];
      if (Array.isArray(resolved.tiles)) {
        for (const tile of resolved.tiles) {
          if (!isRecord(tile) || typeof tile.id !== "number") continue;
          const support = readTileAnimation(resolved, tile.id);
          if (support?.supported === false) {
            unsupportedAnimations.push(`Tile ${tile.id}: ${support.reason}`);
          }
        }
      }
      if (unsupportedAnimations.length > 0) {
        diagnostics.push({
          code: "unsupported-tile-animation",
          message: `Tileset "${resolved.name}" has animations the renderer cannot play. ${unsupportedAnimations.join(" ")} Those tiles render unanimated, as the tile the map places.`,
          severity: "warning",
          tileset: resolved.name,
        });
      }
    }
  }

  return diagnostics;
}
