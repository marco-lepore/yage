import { assertInteger } from "./core/geometry.js";
import type { TileScale } from "./core/types.js";

/** Both engine adapters use the same bounded pixel conversion. */
export function resolveTileScale(scale: TileScale): TileScale {
  assertInteger("TileScale.tileWidth", scale.tileWidth, 1, 1_000_000);
  assertInteger("TileScale.tileHeight", scale.tileHeight, 1, 1_000_000);
  return { tileWidth: scale.tileWidth, tileHeight: scale.tileHeight };
}
