import type { Vec2Like } from "@yagejs/core";
// Type-only: erased at build time, so dist/tilemap.js has no runtime import
// of `@yagejs/tilemap`, an optional peer — the ./tilemap subpath loads even
// when it isn't installed.
import type { TilemapColliderConfig, TilemapData } from "@yagejs/tilemap";
import { shapeAabb, shapeOverlapsCell } from "./colliderRaster.js";
import { GridGraph } from "./GridGraph.js";

export interface GridFromTilemapOptions {
  /** Tile-layer names to read. Omit to read every tile layer. */
  layers?: string[];
  /** A cell blocks if any read layer's cell satisfies this. Default
   *  `gid => gid !== 0`. Receives the base tile id — Tiled's flip/rotation
   *  flag bits are masked off, so a flipped wall matches its plain gid. */
  blocked?: (gid: number, col: number, row: number) => boolean;
  /**
   * Maps a gid to a cell cost, default 1. When multiple read layers give a
   * cell a cost, the highest wins (worse terrain dominates). Each cell's
   * cost is floored at 1 — a return value below 1 is ignored. Not called
   * for gid 0 (no tile).
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
 */
export function gridFromTilemap(
  data: TilemapData,
  options: GridFromTilemapOptions = {},
): GridGraph {
  const cols = data.width;
  const rows = data.height;
  const layers = options.layers
    ? data.tileLayers.filter((l) => options.layers!.includes(l.name))
    : data.tileLayers;
  if (options.layers && layers.length === 0) {
    throw new Error(
      `gridFromTilemap: no tile layer matches [${options.layers.join(", ")}] — ` +
        `available: [${data.tileLayers.map((l) => l.name).join(", ")}]`,
    );
  }
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
        if (cost && gid !== 0)
          cellCost = Math.max(cellCost, cost(gid, col, row));
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
