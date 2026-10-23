import type { Scene, SceneTransitionContext } from "@yagejs/core";
import type { SceneRenderTree } from "../SceneRenderTree.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";

/**
 * The render tree of a scene that takes part in a transition, or `undefined`
 * when `scene` is undefined or has no tree yet. A transition fades, hides,
 * slides and masks the scene through it: `alpha`, `visible`, `setOffset`,
 * `fx` and `setMask`. Call it inside `SceneTransition.begin`, `tick` or
 * `end`.
 */
export function getSceneRenderTree(
  ctx: SceneTransitionContext,
  scene: Scene | undefined,
): SceneRenderTree | undefined {
  if (!scene) return undefined;
  return ctx.engineContext.resolve(SceneRenderTreeProviderKey).getTree(scene);
}

/**
 * Bounds of the declared virtual play area — equivalent to
 * `renderer.virtualSize`. Use this to size a scene mask or a slide, which
 * act in a scene's virtual pixels. A transition overlay reports the region
 * it covers as `TransitionOverlay.area` instead.
 */
export function getVirtualBounds(ctx: SceneTransitionContext): {
  width: number;
  height: number;
} {
  return ctx.engineContext.resolve(RendererKey).virtualSize;
}
