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
 * Bounds of the **scene-root coordinate space** — use this to size masks,
 * translations, or geometry parented to a scene root (or to any descendant
 * of `_worldRoot`, which carries the responsive-fit transform). Equivalent
 * to `renderer.virtualSize`.
 *
 * Use `app.screen.width / .height` instead when parenting directly to
 * `app.stage` — stage sits at identity, so its children operate in
 * canvas/CSS pixels (e.g. fade / flash / iris fullscreen overlays). Pick
 * the helper based on where you `addChild`:
 *
 * - `someSceneRoot.addChild(...)` → `getVirtualBounds(ctx)`
 * - `app.stage.addChild(...)` → `app.screen.width / .height`
 *
 * Mixing the two silently mis-scales geometry under any non-1.0 fit
 * ratio — common on mobile letterbox.
 */
export function getVirtualBounds(ctx: SceneTransitionContext): {
  width: number;
  height: number;
} {
  return ctx.engineContext.resolve(RendererKey).virtualSize;
}
