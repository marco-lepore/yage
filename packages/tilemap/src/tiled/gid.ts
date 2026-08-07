/**
 * Tiled packs a tile's flip and rotation state into the high bits of its
 * global tile ID, leaving the low 28 bits for the id itself.
 */
const FLIPPED_HORIZONTALLY = 0x80000000;
const FLIPPED_VERTICALLY = 0x40000000;
const FLIPPED_DIAGONALLY = 0x20000000;
const TILE_ID_MASK = 0x0fffffff;

/** A tile GID split into the tile it points at and how it is oriented. */
export interface TileGid {
  /** Tile id with the flip bits removed — what a tileset is indexed by. */
  id: number;
  flippedHorizontally: boolean;
  flippedVertically: boolean;
  /** Reflection across the tile's top-left-to-bottom-right diagonal. */
  flippedDiagonally: boolean;
}

/**
 * Split a raw Tiled GID into its tile id and orientation. Layer data in
 * `TilemapData.tileLayers[].data` holds raw GIDs, so a game that cares which
 * way a tile faces reads them through this.
 */
export function readTileGid(gid: number): TileGid {
  return {
    id: gid & TILE_ID_MASK,
    flippedHorizontally: (gid & FLIPPED_HORIZONTALLY) !== 0,
    flippedVertically: (gid & FLIPPED_VERTICALLY) !== 0,
    flippedDiagonally: (gid & FLIPPED_DIAGONALLY) !== 0,
  };
}

/** The tile id a GID points at, with any flip bits removed. */
export function tileIdFromGid(gid: number): number {
  return gid & TILE_ID_MASK;
}

/**
 * `@pixi/tilemap` orients a tile with a Pixi groupD8 value. Measured against
 * a rendered asymmetric tile, the eight even values are:
 *
 * | value | result                                |
 * | ----- | ------------------------------------- |
 * | 0     | unchanged                             |
 * | 2     | rotate 90° counter-clockwise          |
 * | 4     | rotate 180°                           |
 * | 6     | rotate 90° clockwise                  |
 * | 8     | mirror top-to-bottom                  |
 * | 10    | reflect across the main diagonal      |
 * | 12    | mirror left-to-right                  |
 * | 14    | reflect across the anti-diagonal      |
 *
 * Tiled applies its diagonal flip first, then horizontal, then vertical, so
 * each of the eight flag combinations lands on one of those. Indexed by
 * `diagonal << 2 | horizontal << 1 | vertical`.
 */
const ROTATION_BY_FLAGS = [0, 8, 12, 4, 10, 2, 6, 14] as const;

/** The `@pixi/tilemap` rotate value that orients a tile the way Tiled shows it. */
export function tileRotationFromGid(gid: number): number {
  const key =
    ((gid & FLIPPED_DIAGONALLY) !== 0 ? 4 : 0) |
    ((gid & FLIPPED_HORIZONTALLY) !== 0 ? 2 : 0) |
    ((gid & FLIPPED_VERTICALLY) !== 0 ? 1 : 0);
  return ROTATION_BY_FLAGS[key]!;
}
