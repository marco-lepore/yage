import { ErrorBoundaryKey } from "@yagejs/core";
import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { attributed } from "../internal/attribution.js";
import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { getSceneContainer, getVirtualBounds } from "./helpers.js";

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
  /** Easing function applied to the radius. Default: linear. */
  easing?: (t: number) => number;
}

/**
 * Reveal the destination scene through an expanding circular mask. The
 * incoming scene's container is masked by a circle that grows from
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
  const easing = opts.easing ?? ((t) => t);

  let toContainer: Container | undefined;
  let maskGfx: Graphics | undefined;
  let cx = 0;
  let cy = 0;
  let maxRadius = 0;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const provider = ctx.engineContext.resolve(SceneRenderTreeProviderKey);
      if (ctx.toScene) provider.bringSceneToFront?.(ctx.toScene);

      toContainer = getSceneContainer(ctx, ctx.toScene);
      if (!toContainer) return;

      const { width: w, height: h } = getVirtualBounds(ctx);
      cx = opts.center?.x ?? w / 2;
      cy = opts.center?.y ?? h / 2;
      const farX = Math.max(cx, w - cx);
      const farY = Math.max(cy, h - cy);
      maxRadius = Math.hypot(farX, farY);

      maskGfx = new Graphics();
      toContainer.addChild(maskGfx);
      toContainer.setMask({ mask: maskGfx, inverse: false });
      drawCircleMask(maskGfx, cx, cy, 0);
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!maskGfx) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      const r =
        attributed(
          ctx.engineContext.tryResolve(ErrorBoundaryKey),
          { kind: "Scene transition easing", event: "irisReveal" },
          () => easing(t),
        ) * maxRadius;
      drawCircleMask(maskGfx, cx, cy, r);
    },
    end() {
      // Direct assignment — see `chessboard.end()` and `attachMask` for the
      // pixi v8 setMask({ mask: null }) hazard.
      if (toContainer) toContainer.mask = null;
      if (maskGfx) {
        maskGfx.removeFromParent();
        maskGfx.destroy();
        maskGfx = undefined;
      }
      toContainer = undefined;
    },
  };
}

function drawCircleMask(g: Graphics, x: number, y: number, r: number): void {
  g.clear();
  if (r > 0) g.circle(x, y, r).fill({ color: 0xffffff });
}
