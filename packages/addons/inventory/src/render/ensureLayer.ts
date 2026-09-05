import type { Scene } from "@yagejs/core";
import { SceneRenderTreeProviderKey } from "@yagejs/renderer";

export function ensureInventoryLayer(
  scene: Scene,
  name: string,
  order: number,
): void {
  scene.context
    .tryResolve(SceneRenderTreeProviderKey)
    ?.getTree(scene)
    ?.ensureLayer({ name, order, space: "screen" });
}
