import type { Vec2Like } from "@yagejs/core";
// Type-only: erased at build time, so dist/tilemap.js has no runtime import
// of `@yagejs/tilemap`, an optional peer — the ./tilemap subpath loads even
// when it isn't installed.
import type { TilemapColliderConfig, TilemapData } from "@yagejs/tilemap";
import { shapeAabb, shapeOverlapsCell } from "./colliderRaster.js";
import { GridGraph } from "./GridGraph.js";
import { assertFiniteCost } from "./validate.js";

export interface GridFromTilemapOptions {
  /**
   * Tile-layer names to read. Required, and every name must match a layer:
   * reading every layer blocks each cell any layer paints, which makes a map
   * with a filled ground layer impassable, and an unmatched name would drop
   * that layer's walls without a word.
   */
  layers: readonly string[];
  /** A cell blocks if any read layer's cell satisfies this. Default
   *  `gid => gid !== 0`. Receives the base tile id — Tiled's flip/rotation
   *  flag bits are masked off, so a flipped wall matches its plain gid. */
  blocked?: (gid: number, col: number, row: number) => boolean;
  /**
   * Maps a gid to a cell cost, default 1. Must return a finite number;
   * `NaN` or `Infinity` throws. When multiple read layers give a cell a
   * cost, the highest wins (worse terrain dominates). Each cell's cost is
   * floored at 1 — a return value below 1 is ignored. Not called for gid 0
   * (no tile).
   */
  cost?: (gid: number, col: number, row: number) => number;
  /** World-pixel position of cell `(0,0)`'s top-left corner. Default `(0,0)`. */
  origin?: Vec2Like;
}

const DEFAULT_BLOCKED = (gid: number): boolean => gid !== 0;

/** Tiled stores flip/rotation flags in a gid's four high bits; masking them
 *  off recovers the base tile id the `blocked`/`cost` callbacks match on. */
const GID_MASK = 0x0fffffff;

/**
 * Builds a `GridGraph` from a tilemap's tile layers. Precomputes a
 * walkability + cost pass over the grid once; the returned graph's
 * `isWalkable`/`cost` read the precomputed arrays instead of re-scanning the
 * layers on every `findPath` call.
 *
 * Cells come from the tile grid alone: a layer's `offsetX`/`offsetY` shifts
 * where that layer draws, not which cell a tile occupies, and layers read
 * together can carry different offsets. Set `origin` to move the whole grid.
 */
export function gridFromTilemap(
  data: TilemapData,
  options: GridFromTilemapOptions,
): GridGraph {
  const cols = data.width;
  const rows = data.height;
  const available = data.tileLayers.map((l) => l.name);
  // A JavaScript caller can leave the options object or `layers` out even
  // though both are required, so the missing case is named here instead of
  // failing on a property read.
  const requested: readonly string[] | undefined = options?.layers;
  if (requested === undefined || requested.length === 0) {
    throw new Error(
      `gridFromTilemap: layers must name at least one tile layer, got ${
        requested === undefined ? "undefined" : "[]"
      }.`,
    );
  }
  // Every name is checked, not just the whole list: one typo among several
  // would otherwise drop that layer's walls and still build a grid.
  const unmatched = requested.filter((name) => !available.includes(name));
  if (unmatched.length > 0) {
    throw new Error(
      `gridFromTilemap: no tile layer matches [${unmatched.join(", ")}] — ` +
        `available: [${available.join(", ")}]`,
    );
  }
  const layers = data.tileLayers.filter((l) => requested.includes(l.name));
  const blocked = options.blocked ?? DEFAULT_BLOCKED;
  const cost = options.cost;

  const walkable = new Uint8Array(cols * rows);
  const costs = new Float64Array(cols * rows).fill(1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      let isBlocked = false;
      let cellCost = 1;
      for (const layer of layers) {
        const gid = (layer.data[index] ?? 0) & GID_MASK;
        if (blocked(gid, col, row)) isBlocked = true;
        if (cost && gid !== 0) {
          const value = cost(gid, col, row);
          assertFiniteCost("gridFromTilemap", value, col, row, gid);
          cellCost = Math.max(cellCost, value);
        }
      }
      walkable[index] = isBlocked ? 0 : 1;
      costs[index] = cellCost;
    }
  }

  return new GridGraph({
    cols,
    rows,
    tileWidth: data.tileWidth,
    tileHeight: data.tileHeight,
    isWalkable: (col, row) => walkable[row * cols + col] === 1,
    cost: (col, row) => costs[row * cols + col]!,
    ...(options.origin ? { origin: options.origin } : {}),
  });
}

export interface GridFromCollidersOptions {
  /** Shapes in map-local pixels — typically `tilemap.getCollisionShapes("<layer>")`. */
  shapes: readonly TilemapColliderConfig[];
  /** World-pixel position of cell `(0,0)`'s top-left corner. Default `(0,0)`. */
  origin?: Vec2Like;
}

/**
 * Builds a `GridGraph` from Tiled object-layer collision shapes (rects,
 * circles, capsules, polygons, polylines) instead of tile-layer gids. A cell
 * blocks if any shape overlaps any part of it — grazing a cell's edge is
 * enough. Cost is 1 everywhere. Precomputes the walkability pass once over
 * the grid; the returned graph's `isWalkable` reads the precomputed array
 * instead of re-testing shapes on every `findPath` call.
 *
 * Grid dimensions and tile size come from `data`, not from the shapes —
 * `shapes` only supplies which cells are blocked.
 */
export function gridFromColliders(
  data: TilemapData,
  options: GridFromCollidersOptions,
): GridGraph {
  const cols = data.width;
  const rows = data.height;
  const tileWidth = data.tileWidth;
  const tileHeight = data.tileHeight;

  const walkable = new Uint8Array(cols * rows).fill(1);

  for (const shape of options.shapes) {
    const bounds = shapeAabb(shape);
    const colMin = Math.max(
      0,
      Math.min(cols - 1, Math.floor(bounds.minX / tileWidth) - 1),
    );
    const colMax = Math.max(
      0,
      Math.min(cols - 1, Math.floor(bounds.maxX / tileWidth) + 1),
    );
    const rowMin = Math.max(
      0,
      Math.min(rows - 1, Math.floor(bounds.minY / tileHeight) - 1),
    );
    const rowMax = Math.max(
      0,
      Math.min(rows - 1, Math.floor(bounds.maxY / tileHeight) + 1),
    );

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const index = row * cols + col;
        if (walkable[index] === 0) continue; // already blocked by an earlier shape
        const cellMinX = col * tileWidth;
        const cellMinY = row * tileHeight;
        if (
          shapeOverlapsCell(
            shape,
            cellMinX,
            cellMinY,
            cellMinX + tileWidth,
            cellMinY + tileHeight,
          )
        ) {
          walkable[index] = 0;
        }
      }
    }
  }

  return new GridGraph({
    cols,
    rows,
    tileWidth,
    tileHeight,
    isWalkable: (col, row) => walkable[row * cols + col] === 1,
    ...(options.origin ? { origin: options.origin } : {}),
  });
}
