import type { Scene } from "@yagejs/core";
import { SceneRenderTreeProviderKey } from "@yagejs/renderer";

export function ensureDialogueLayer(
  scene: Scene,
  name: string,
  order: number,
  space: "screen" | "world" = "screen",
): void {
  scene.context
    .tryResolve(SceneRenderTreeProviderKey)
    ?.getTree(scene)
    ?.ensureLayer({ name, order, space });
}
