import type { Scene } from "@yagejs/core";
import { SceneRenderTreeKey } from "@yagejs/renderer";

export function ensureInventoryLayer(
  scene: Scene,
  name: string,
  order: number,
): void {
  scene
    .tryResolveScoped(SceneRenderTreeKey)
    ?.ensureLayer({ name, order, space: "screen" });
}
