import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import type { DrawContext } from "../DrawContext.js";
import { graphicsMask } from "../masks/graphicsMask.js";
import type { MaskHandle } from "../masks/MaskHandle.js";
import type { SceneRenderTree } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";
import { getSceneRenderTree, getVirtualBounds } from "./helpers.js";
import { createTransitionOverlay } from "./overlay.js";
import type { TransitionOverlay } from "./overlay.js";

export interface IrisOptions {
  /** Iris duration in seconds. Default: 0.6. */
  duration?: number;
  /** Fill color visible outside the iris. Default: 0x000000. */
  color?: number;
  /**
   * Iris center in **virtual-space pixels** — the same coord system you
   * use for game logic. Default: virtual-space center. The maximum radius
   * is the distance from this point to the farthest corner of whatever
   * the overlay covers (virtual rect by default, full canvas under
   * `coverScreen: true`), so the iris always fully covers its target at
   * the mid-point.
   */
  center?: { x: number; y: number };
  /**
   * When `true`, the dip-to-color overlay covers the full canvas
   * including letterbox / expand bars. When `false` (default), it covers
   * only the virtual play area — bars stay visible during the dip.
   */
  coverScreen?: boolean;
}

/**
 * Iris-out → swap → iris-in. A circular cut-out of the screen shrinks to
 * zero over the first half (covering everything in `color`), then grows
 * back over the second half to reveal the destination. Symmetric to
 * `fade()` but with a circular shape — useful for retro-style transitions
 * (Zelda overworld→cave, classic Mario level intros).
 *
 * Implementation: a fullscreen color overlay carries an inverse circular
 * mask so the area inside the circle stays transparent (revealing the
 * scene below) while the outside fills with `color`. The mask is redrawn
 * each frame to animate the radius.
 *
 * - push/replace: incoming scene stays hidden until the half-way mark,
 *   then is revealed underneath the opening iris.
 * - pop: outgoing scene stays visible through the closing iris, then is
 *   hidden at the half-way mark so the destination shows through during
 *   the opening half.
 */
export function iris(opts: IrisOptions = {}): SceneTransition {
  const duration = opts.duration ?? 0.6;
  const color = opts.color ?? 0x000000;
  const coverScreen = opts.coverScreen ?? false;

  let overlay: TransitionOverlay | undefined;
  let mask: MaskHandle | undefined;
  let cx = 0;
  let cy = 0;
  let radius = 0;
  let maxRadius = 0;
  let toTree: SceneRenderTree | undefined;
  let fromTree: SceneRenderTree | undefined;
  let crossedHalfway = false;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const virtual = getVirtualBounds(ctx);
      const cxv = opts.center?.x ?? virtual.width / 2;
      const cyv = opts.center?.y ?? virtual.height / 2;
      overlay = createTransitionOverlay(ctx, { coverScreen });
      const { x, y, width, height } = overlay.area;
      if (coverScreen) {
        // The overlay is in canvas pixels; the center stays in game coords.
        const canvasCenter = ctx.engineContext
          .resolve(RendererKey)
          .virtualToCanvas(cxv, cyv);
        cx = canvasCenter.x;
        cy = canvasCenter.y;
      } else {
        cx = cxv;
        cy = cyv;
      }
      const farX = Math.max(cx - x, x + width - cx);
      const farY = Math.max(cy - y, y + height - cy);
      maxRadius = Math.hypot(farX, farY);
      radius = maxRadius;

      overlay.draw((g) => g.rect(x, y, width, height).fill({ color }));
      // The inverse mask keeps the colour outside the circle, so the scene
      // shows through the hole.
      mask = overlay.setMask(
        graphicsMask((g) => drawCircleMask(g, cx, cy, radius)),
      );
      mask.setInverse(true);

      crossedHalfway = false;
      if (ctx.kind === "pop") {
        fromTree = getSceneRenderTree(ctx, ctx.fromScene);
      } else {
        toTree = getSceneRenderTree(ctx, ctx.toScene);
        if (toTree) toTree.visible = false;
      }
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!mask) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      radius = Math.abs(1 - t * 2) * maxRadius;
      mask.redraw();
      if (!crossedHalfway && t >= 0.5) {
        if (toTree) toTree.visible = true;
        if (fromTree) fromTree.visible = false;
        crossedHalfway = true;
      }
    },
    end() {
      overlay?.destroy();
      overlay = undefined;
      mask = undefined;
      // Restore visibility on the incoming scene as a `clear()`-mid-run
      // safety net. Deliberately do NOT restore the outgoing scene: on
      // pop/replace it's about to be destroyed but `end()` fires inside
      // the tick's update phase before PIXI renders, so restoring would
      // paint the outgoing scene for one last frame.
      if (toTree) toTree.visible = true;
      toTree = undefined;
      fromTree = undefined;
      crossedHalfway = false;
    },
  };
}

function drawCircleMask(g: DrawContext, x: number, y: number, r: number): void {
  g.clear();
  // A zero-radius circle would still register as a draw command; skip so
  // the inverse mask cleanly degrades to "fully covered" at the midpoint.
  if (r > 0) g.circle(x, y, r).fill({ color: 0xffffff });
}
