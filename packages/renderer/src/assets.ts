import { AssetHandle } from "@yage/core";
import type { Texture, Spritesheet } from "pixi.js";

/** Create a typed asset handle for a texture. */
export function texture(path: string): AssetHandle<Texture> {
  return new AssetHandle("texture", path);
}

/** Create a typed asset handle for a spritesheet JSON atlas. */
export function spritesheet(path: string): AssetHandle<Spritesheet> {
  return new AssetHandle("spritesheet", path);
}
