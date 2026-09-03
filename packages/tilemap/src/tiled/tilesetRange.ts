/** The global tile IDs one tileset owns. */
export interface TilesetRange {
  /** First global tile ID of the tileset. */
  firstgid: number;
  /**
   * Number of tiles, for a single-image tileset: its IDs are dense, so the
   * count is the end of the range. Absent for the two other forms.
   */
  tilecount?: number;
  /**
   * Local IDs a collection-of-images tileset draws. Tiled keeps the other
   * tiles' IDs when an image is deleted, so a collection's IDs are neither
   * dense nor bounded by `tilecount` — the set it lists is what it owns.
   * Absent for a single-image tileset and for one whose data has not
   * resolved, which leaves the end of its range unknown.
   */
  tileIds?: ReadonlySet<number>;
}

/**
 * Local IDs a resolved collection-of-images tileset draws. Reads raw map JSON,
 * so an entry that is not a tile with a numeric ID and an image is skipped.
 */
export function collectionTileIds(
  tiles: readonly unknown[] | undefined,
): ReadonlySet<number> {
  const ids = new Set<number>();
  if (!Array.isArray(tiles)) return ids;
  for (const tile of tiles) {
    if (typeof tile !== "object" || tile === null) continue;
    const entry = tile as { id?: unknown; image?: unknown };
    if (typeof entry.id !== "number") continue;
    if (typeof entry.image !== "string") continue;
    ids.add(entry.id);
  }
  return ids;
}

/**
 * Index of the tileset that owns `gid`, or `-1` when none does. Tiled numbers
 * tilesets from `firstgid` upward, so the candidate is the last tileset
 * starting at or below the gid, and it owns the gid when its own IDs cover it.
 * A tileset whose data has not resolved states neither, so its range runs up
 * to the next tileset's `firstgid`.
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
  const localId = gid - owner.firstgid;
  if (owner.tilecount !== undefined && localId >= owner.tilecount) return -1;
  if (owner.tileIds !== undefined && !owner.tileIds.has(localId)) return -1;
  return index;
}
