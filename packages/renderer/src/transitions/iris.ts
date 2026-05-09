import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Application, Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer, getVirtualBounds } from "./helpers.js";

export interface IrisOptions {
  /** Iris duration in ms. Default: 600. */
  duration?: number;
  /** Fill color visible outside the iris. Default: 0x000000. */
  color?: number;
  /**
   * Iris center in virtual-space pixels. Default: virtual-space center.
   * The maximum radius is the distance from this point to the farthest
   * corner of the virtual rect, so the iris always fully covers the
   * canvas at the mid-point.
   */
  center?: { x: number; y: number };
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
  const duration = opts.duration ?? 600;
  const color = opts.color ?? 0x000000;

  let app: Application | undefined;
  let overlay: Graphics | undefined;
  let maskGfx: Graphics | undefined;
  let cx = 0;
  let cy = 0;
  let maxRadius = 0;
  let toContainer: Container | undefined;
  let fromContainer: Container | undefined;
  let crossedHalfway = false;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      app = ctx.engineContext.resolve(RendererKey).application;
      const { width: w, height: h } = getVirtualBounds(ctx);
      cx = opts.center?.x ?? w / 2;
      cy = opts.center?.y ?? h / 2;
      const farX = Math.max(cx, w - cx);
      const farY = Math.max(cy, h - cy);
      maxRadius = Math.hypot(farX, farY);

      overlay = new Graphics();
      overlay.rect(0, 0, w, h).fill({ color, alpha: 1 });
      maskGfx = new Graphics();
      drawCircleMask(maskGfx, cx, cy, maxRadius);
      overlay.addChild(maskGfx);
      overlay.setMask({ mask: maskGfx, inverse: true });
      app.stage.addChild(overlay);

      crossedHalfway = false;
      if (ctx.kind === "pop") {
        fromContainer = getSceneContainer(ctx, ctx.fromScene);
      } else {
        toContainer = getSceneContainer(ctx, ctx.toScene);
        if (toContainer) toContainer.visible = false;
      }
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!maskGfx) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      const r = Math.abs(1 - t * 2) * maxRadius;
      drawCircleMask(maskGfx, cx, cy, r);
      if (!crossedHalfway && t >= 0.5) {
        if (toContainer) toContainer.visible = true;
        if (fromContainer) fromContainer.visible = false;
        crossedHalfway = true;
      }
    },
    end() {
      if (overlay) {
        overlay.destroy({ children: true });
        overlay = undefined;
      }
      maskGfx = undefined;
      // Restore visibility on the incoming scene as a `clear()`-mid-run
      // safety net. Deliberately do NOT restore `fromContainer`: on
      // pop/replace it's about to be destroyed but `end()` fires inside
      // the tick's update phase before PIXI renders, so restoring would
      // paint the outgoing scene for one last frame.
      if (toContainer) toContainer.visible = true;
      toContainer = undefined;
      fromContainer = undefined;
      crossedHalfway = false;
      app = undefined;
    },
  };
}

function drawCircleMask(g: Graphics, x: number, y: number, r: number): void {
  g.clear();
  // A zero-radius circle would still register as a draw command; skip so
  // the inverse mask cleanly degrades to "fully covered" at the midpoint.
  if (r > 0) g.circle(x, y, r).fill({ color: 0xffffff });
}
