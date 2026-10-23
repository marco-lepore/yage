import { easeLinear, ErrorBoundaryKey } from "@yagejs/core";
import type {
  EasingFunction,
  SceneTransition,
  SceneTransitionContext,
} from "@yagejs/core";
import type { DrawContext } from "../DrawContext.js";
import { attributed } from "../internal/attribution.js";
import { graphicsMask } from "../masks/graphicsMask.js";
import type { MaskHandle } from "../masks/MaskHandle.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { getSceneRenderTree, getVirtualBounds } from "./helpers.js";

export interface IrisRevealOptions {
  /** Iris duration in seconds. Default: 0.6. */
  duration?: number;
  /**
   * Iris center in virtual-space pixels. Default: virtual-space center.
   * The maximum radius is the distance from this point to the farthest
   * corner of the virtual rect, so the iris always fully covers the
   * canvas at `t = 1`.
   */
  center?: { x: number; y: number };
  /** Easing function applied to the radius. Default: `easeLinear`. */
  easing?: EasingFunction;
}

/**
 * Reveal the destination scene through an expanding circular mask. The
 * incoming scene is masked by a circle that grows from
 * radius 0 to a radius covering the canvas, so the new scene "blooms"
 * over the previous one from the chosen center point. The previous
 * scene stays visible outside the iris until the circle fully covers
 * it — no color overlay, no mid-point swap.
 *
 * Pairs with `iris()` (the symmetric close-then-open variant): pick
 * `iris` for retro Zelda-style dip-to-black handoffs, `irisReveal` for
 * a one-way reveal where the new scene grows over the old.
 *
 * On `pop` the destination scene is brought to the front of the scene
 * stack so the same mechanic applies — without it the outgoing scene
 * would render over the masked destination.
 */
export function irisReveal(opts: IrisRevealOptions = {}): SceneTransition {
  const duration = opts.duration ?? 0.6;
  const easing = opts.easing ?? easeLinear;

  let mask: MaskHandle | undefined;
  let cx = 0;
  let cy = 0;
  let radius = 0;
  let maxRadius = 0;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const provider = ctx.engineContext.resolve(SceneRenderTreeProviderKey);
      if (ctx.toScene) provider.bringSceneToFront?.(ctx.toScene);

      const toTree = getSceneRenderTree(ctx, ctx.toScene);
      if (!toTree) return;

      const { width: w, height: h } = getVirtualBounds(ctx);
      cx = opts.center?.x ?? w / 2;
      cy = opts.center?.y ?? h / 2;
      const farX = Math.max(cx, w - cx);
      const farY = Math.max(cy, h - cy);
      maxRadius = Math.hypot(farX, farY);

      radius = 0;
      // The transition mask sets aside any mask the scene set for itself,
      // and removing it in `end()` puts that mask back.
      mask = toTree.setTransitionMask(
        graphicsMask((g) => drawCircleMask(g, cx, cy, radius)),
      );
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!mask) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      radius =
        attributed(
          ctx.engineContext.tryResolve(ErrorBoundaryKey),
          { kind: "Scene transition easing", event: "irisReveal" },
          () => easing(t),
        ) * maxRadius;
      mask.redraw();
    },
    end() {
      mask?.remove();
      mask = undefined;
    },
  };
}

function drawCircleMask(g: DrawContext, x: number, y: number, r: number): void {
  g.clear();
  if (r > 0) g.circle(x, y, r).fill({ color: 0xffffff });
}
