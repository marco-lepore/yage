import type { Scene, SceneTransitionContext } from "@yagejs/core";
import type { Container } from "pixi.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";

/**
 * Resolve the root container for a scene that participates in a transition.
 * Returns `undefined` if `scene` is undefined or its tree hasn't been
 * materialized. Intended for use inside `SceneTransition.begin/tick/end`
 * so custom transitions can manipulate per-scene containers without
 * boilerplate.
 */
export function getSceneContainer(
  ctx: SceneTransitionContext,
  scene: Scene | undefined,
): Container | undefined {
  if (!scene) return undefined;
  return ctx.engineContext
    .resolve(SceneRenderTreeProviderKey)
    .getTree(scene)?.root;
}
