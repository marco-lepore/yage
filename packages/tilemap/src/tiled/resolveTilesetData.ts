import type { TilesetData, TilesetRef } from "./types.js";

/**
 * The tileset data for a reference: the loaded external JSON, or the fields
 * inlined on an embedded reference. Returns `null` for an external reference
 * the loader has not resolved yet, and for an embedded one missing the fields
 * needed to place a tile.
 */
export function resolveTilesetData(ref: TilesetRef): TilesetData | null {
  if (ref.data) return ref.data;
  if (ref.source !== undefined) return null;

  if (
    typeof ref.name !== "string" ||
    typeof ref.tilewidth !== "number" ||
    typeof ref.tileheight !== "number" ||
    typeof ref.tilecount !== "number" ||
    typeof ref.columns !== "number"
  ) {
    return null;
  }

  // Copy rather than return `ref`: the loader assigns the result back to
  // `ref.data`, and a reference to itself would make the asset unserializable.
  // The spread keeps fields `TilesetData` doesn't model (wangsets, grid,
  // per-tile objectgroup), which a game reading the raw tileset may want.
  const tileset = { ...ref } as Partial<TilesetRef>;
  delete tileset.firstgid;
  delete tileset.data;
  return tileset as TilesetData;
}
