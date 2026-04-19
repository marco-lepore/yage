import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import type { Container } from "pixi.js";
import { getSceneContainer } from "./helpers.js";

export interface CrossFadeOptions {
  /** Duration in ms. Default: 400. */
  duration?: number;
}

/**
 * Cross-dissolve between two scenes: the outgoing scene fades from full
 * opacity to zero while the incoming scene fades in. Both scenes remain
 * visible throughout, so there's no blackout in the middle — good for
 * menu→game and level→level handoffs.
 */
export function crossFade(opts: CrossFadeOptions = {}): SceneTransition {
  const duration = opts.duration ?? 400;

  let fromContainer: Container | undefined;
  let toContainer: Container | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      fromContainer = getSceneContainer(ctx, ctx.fromScene);
      toContainer = getSceneContainer(ctx, ctx.toScene);
      if (fromContainer) fromContainer.alpha = 1;
      if (toContainer) toContainer.alpha = 0;
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      const t = Math.min(ctx.elapsed / duration, 1);
      if (fromContainer) fromContainer.alpha = 1 - t;
      if (toContainer) toContainer.alpha = t;
    },
    end(ctx: SceneTransitionContext) {
      // Only restore the outgoing alpha when the outgoing scene survives
      // (push keeps it on the stack, paused below). For pop/replace the
      // outgoing scene is about to be removed — restoring to 1 here causes
      // a one-frame flash because end() fires during the tick phase,
      // before the same rAF's render runs, while the actual removal waits
      // on a microtask.
      if (fromContainer && ctx.kind === "push") fromContainer.alpha = 1;
      if (toContainer) toContainer.alpha = 1;
      fromContainer = undefined;
      toContainer = undefined;
    },
  };
}
