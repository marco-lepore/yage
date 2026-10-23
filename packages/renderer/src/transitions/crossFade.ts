import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import type { SceneRenderTree } from "../SceneRenderTree.js";
import { getSceneRenderTree } from "./helpers.js";

export interface CrossFadeOptions {
  /** Duration in seconds. Default: 0.4. */
  duration?: number;
}

/**
 * Cross-dissolve between two scenes: the outgoing scene fades from full
 * opacity to zero while the incoming scene fades in. Both scenes remain
 * visible throughout, so there's no blackout in the middle — good for
 * menu→game and level→level handoffs.
 */
export function crossFade(opts: CrossFadeOptions = {}): SceneTransition {
  const duration = opts.duration ?? 0.4;

  let fromTree: SceneRenderTree | undefined;
  let toTree: SceneRenderTree | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      fromTree = getSceneRenderTree(ctx, ctx.fromScene);
      toTree = getSceneRenderTree(ctx, ctx.toScene);
      if (fromTree) fromTree.alpha = 1;
      if (toTree) toTree.alpha = 0;
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      const t = Math.min(ctx.elapsed / duration, 1);
      if (fromTree) fromTree.alpha = 1 - t;
      if (toTree) toTree.alpha = t;
    },
    end(ctx: SceneTransitionContext) {
      // Only restore the outgoing alpha when the outgoing scene survives
      // (push keeps it on the stack, paused below). For pop/replace the
      // outgoing scene is about to be removed — restoring to 1 here causes
      // a one-frame flash because end() fires during the tick phase,
      // before the same rAF's render runs, while the actual removal waits
      // on a microtask.
      if (fromTree && ctx.kind === "push") fromTree.alpha = 1;
      if (toTree) toTree.alpha = 1;
      fromTree = undefined;
      toTree = undefined;
    },
  };
}
