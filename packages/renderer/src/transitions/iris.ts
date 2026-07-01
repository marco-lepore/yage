import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Container, Graphics } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer, getVirtualBounds } from "./helpers.js";

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

  let overlay: Container | undefined;
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
      const renderer = ctx.engineContext.resolve(RendererKey);
      const virtual = getVirtualBounds(ctx);
      const cxv = opts.center?.x ?? virtual.width / 2;
      const cyv = opts.center?.y ?? virtual.height / 2;

      let rx: number;
      let ry: number;
      let rw: number;
      let rh: number;
      if (coverScreen) {
        // Overlay covers the canvas including bars; sized + positioned in
        // canvas pixels. Convert the virtual-px center through the fit
        // transform so callers stay in game coords either way.
        const screen = renderer.application.screen;
        rx = 0;
        ry = 0;
        rw = screen.width;
        rh = screen.height;
        const canvasCenter = renderer.virtualToCanvas(cxv, cyv);
        cx = canvasCenter.x;
        cy = canvasCenter.y;
      } else {
        // Overlay scoped to the on-screen canvas extent in virtual pixels.
        // Under letterbox the worldRoot mask clips overshoot back to
        // virtual; under expand the overlay paints into the bars too.
        const r = renderer.visibleCanvasRect;
        rx = r.x;
        ry = r.y;
        rw = r.width;
        rh = r.height;
        cx = cxv;
        cy = cyv;
      }
      const farX = Math.max(cx - rx, rx + rw - cx);
      const farY = Math.max(cy - ry, ry + rh - cy);
      maxRadius = Math.hypot(farX, farY);

      // Pixi v8: Graphics is no longer a Container — children must live on
      // a real Container. The overlay holds the color fill + mask geometry.
      overlay = new Container();
      const fill = new Graphics();
      fill.rect(rx, ry, rw, rh).fill({ color, alpha: 1 });
      maskGfx = new Graphics();
      drawCircleMask(maskGfx, cx, cy, maxRadius);
      overlay.addChild(fill);
      overlay.addChild(maskGfx);
      overlay.setMask({ mask: maskGfx, inverse: true });
      if (coverScreen) {
        renderer.application.stage.addChild(overlay);
      } else {
        renderer.worldRoot.addChild(overlay);
      }

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
    },
  };
}

function drawCircleMask(g: Graphics, x: number, y: number, r: number): void {
  g.clear();
  // A zero-radius circle would still register as a draw command; skip so
  // the inverse mask cleanly degrades to "fully covered" at the midpoint.
  if (r > 0) g.circle(x, y, r).fill({ color: 0xffffff });
}
