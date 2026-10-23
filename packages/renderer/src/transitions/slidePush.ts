import { easeOutCubic, ErrorBoundaryKey } from "@yagejs/core";
import type {
  EasingFunction,
  SceneTransition,
  SceneTransitionContext,
} from "@yagejs/core";
import { attributed } from "../internal/attribution.js";
import type { SceneRenderTree } from "../SceneRenderTree.js";
import { getSceneRenderTree, getVirtualBounds } from "./helpers.js";

/** Direction the outgoing scene exits the frame in. */
export type SlideDirection = "left" | "right" | "up" | "down";

export interface SlidePushOptions {
  /** Total duration in seconds. Default: 0.5. */
  duration?: number;
  /**
   * Direction the OUTGOING scene exits in. The incoming scene enters from
   * the opposite edge. Default: `"left"` (incoming slides in from the right,
   * pushing the previous scene off to the left — book-style forward turn).
   */
  direction?: SlideDirection;
  /**
   * When `true` (default), `pop` reverses `direction` so the back motion
   * mirrors the forward motion — pairs naturally with a scene's
   * `defaultTransition`. Set to `false` if the call-site direction is
   * already authored for a specific kind.
   */
  reverseOnPop?: boolean;
  /** Easing function applied to the slide progress. Default: `easeOutCubic`. */
  easing?: EasingFunction;
}

/**
 * Slide both scenes off and on together: the incoming scene enters from
 * one edge while the outgoing scene exits the opposite edge at the same
 * pace, locked together as a single horizontal/vertical translation.
 * Ideal for menu carousels, level-to-level book turns, or wizard flows.
 *
 * Unlike a pure `slideIn`, this transition moves BOTH scenes,
 * giving the visual impression that the new scene is physically pushing
 * the old one off the screen.
 *
 * On `pop`, the direction is mirrored by default so that "back" reverses
 * "forward" — opt out via `reverseOnPop: false` for explicit control.
 */
export function slidePush(opts: SlidePushOptions = {}): SceneTransition {
  const duration = opts.duration ?? 0.5;
  const direction = opts.direction ?? "left";
  const reverseOnPop = opts.reverseOnPop ?? true;
  const easing = opts.easing ?? easeOutCubic;

  let toTree: SceneRenderTree | undefined;
  let fromTree: SceneRenderTree | undefined;
  let dx = 0;
  let dy = 0;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const { width: w, height: h } = getVirtualBounds(ctx);
      const effective =
        ctx.kind === "pop" && reverseOnPop ? reverse(direction) : direction;
      const off = directionOffsets(effective, w, h);
      dx = off.dx;
      dy = off.dy;

      fromTree = getSceneRenderTree(ctx, ctx.fromScene);
      toTree = getSceneRenderTree(ctx, ctx.toScene);
      toTree?.setOffset(-dx, -dy);
      fromTree?.setOffset(0, 0);
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      const t = attributed(
        ctx.engineContext.tryResolve(ErrorBoundaryKey),
        { kind: "Scene transition easing", event: "slidePush" },
        () => easing(Math.min(ctx.elapsed / duration, 1)),
      );
      toTree?.setOffset(-dx * (1 - t), -dy * (1 - t));
      fromTree?.setOffset(dx * t, dy * t);
    },
    end(ctx: SceneTransitionContext) {
      toTree?.setOffset(0, 0);
      // Only reset the outgoing scene when it survives (push). On pop /
      // replace it's about to be destroyed and a one-frame snap back to
      // origin would flash before teardown — same hazard `crossFade`
      // documents at end().
      if (ctx.kind === "push") fromTree?.setOffset(0, 0);
      toTree = undefined;
      fromTree = undefined;
    },
  };
}

function reverse(d: SlideDirection): SlideDirection {
  switch (d) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "up":
      return "down";
    case "down":
      return "up";
  }
}

function directionOffsets(
  d: SlideDirection,
  w: number,
  h: number,
): { dx: number; dy: number } {
  switch (d) {
    case "left":
      return { dx: -w, dy: 0 };
    case "right":
      return { dx: w, dy: 0 };
    case "up":
      return { dx: 0, dy: -h };
    case "down":
      return { dx: 0, dy: h };
  }
}
