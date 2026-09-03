/** The span of global tile IDs one tileset owns. */
export interface TilesetRange {
  /** First global tile ID of the tileset. */
  firstgid: number;
  /**
   * Number of tiles in the tileset, for a single-image tileset only. Absent
   * when the tileset data has not resolved, and for a collection-of-images
   * tileset: Tiled keeps a collection tile's id when an image is deleted, so
   * its ids can run past `tilecount`. Either way the end of the range is
   * unknown.
   */
  tilecount?: number;
}

/**
 * Index of the tileset that owns `gid`, or `-1` when none does. Tiled numbers
 * tilesets from `firstgid` upward, so the owner is the last tileset starting at
 * or below the gid, provided the gid also falls inside its tile count. A
 * tileset without a count (unresolved, or a collection of images) has a range
 * that runs up to the next tileset's `firstgid`.
 */
export function findTilesetIndexForGid(
  ranges: readonly TilesetRange[],
  gid: number,
): number {
  let index = -1;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (range.firstgid > gid) continue;
    if (index >= 0 && ranges[index]!.firstgid >= range.firstgid) continue;
    index = i;
  }
  if (index < 0) return -1;

  const owner = ranges[index]!;
  if (
    owner.tilecount !== undefined &&
    gid >= owner.firstgid + owner.tilecount
  ) {
    return -1;
  }
  return index;
}
