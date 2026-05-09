import type { Scene, SceneTransitionContext } from "@yagejs/core";
import type { Container } from "pixi.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";

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

/**
 * Bounds of the scene-stage coordinate space — the size that geometry
 * parented to `app.stage` (or to a scene root) must use to cover the
 * viewport. Equivalent to `renderer.virtualSize`.
 *
 * Do **not** read `app.screen` here. The fit controller installs a
 * scale + translate on `app.stage`, so its children operate in
 * virtual-space pixels; sizing a fullscreen overlay or mask from
 * `app.screen` (which returns canvas/CSS pixels) silently shrinks or
 * stretches the geometry under any non-1.0 fit ratio — common on mobile
 * letterbox.
 */
export function getVirtualBounds(ctx: SceneTransitionContext): {
  width: number;
  height: number;
} {
  return ctx.engineContext.resolve(RendererKey).virtualSize;
}
