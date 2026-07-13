import type { Scene, SceneTransitionContext } from "@yagejs/core";
import type { DisplayContainer } from "../public-types.js";
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
): DisplayContainer | undefined {
  if (!scene) return undefined;
  return ctx.engineContext
    .resolve(SceneRenderTreeProviderKey)
    .getTree(scene)?.root;
}

/**
 * Bounds of the declared virtual play area — equivalent to
 * `renderer.virtualSize`. Use this to size masks, translations, or
 * geometry that's scoped to a single scene's content (e.g. a per-cell
 * mask painted onto a scene root). Children of scene roots and of
 * `_worldRoot` operate in virtual pixels.
 *
 * For full-screen overlays parented to `renderer.worldRoot`, prefer
 * `renderer.visibleCanvasRect` — it equals the virtual rect under
 * `letterbox` (clipped) but extends into the bars under `expand`, which
 * is usually what an obscuring overlay wants. For overlays that must
 * also paint over letterbox bars, parent on `app.stage` and size in
 * canvas pixels via `app.screen.width / .height`.
 */
export function getVirtualBounds(ctx: SceneTransitionContext): {
  width: number;
  height: number;
} {
  return ctx.engineContext.resolve(RendererKey).virtualSize;
}
