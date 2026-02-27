import { AssetHandle } from "@yage/core";
import type { Texture } from "pixi.js";

/** Create a typed asset handle for a texture. */
export function texture(path: string): AssetHandle<Texture> {
  return new AssetHandle("texture", path);
}
