import { AssetHandle } from "@yagejs/core";
import type { Sound } from "@pixi/sound";

/** Create a typed asset handle for a sound effect. */
export function sound(path: string): AssetHandle<Sound> {
  return new AssetHandle("sound", path);
}
