import { AssetHandle } from "@yagejs/core";
import type { TiledMapData } from "./tiled/types.js";

/** Create a typed asset handle for a Tiled map JSON. */
export function tiledMap(path: string): AssetHandle<TiledMapData> {
  return new AssetHandle("tiledMap", path);
}
