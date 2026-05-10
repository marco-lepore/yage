import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer } from "./helpers.js";

export interface FlashOptions {
  /** Flash duration in ms. Default: 200. */
  duration?: number;
  /** Flash color as a hex number. Default: 0xffffff. */
  color?: number;
  /**
   * When `true`, the overlay covers the full canvas including
   * letterbox / expand bars. When `false` (default), it covers only the
   * virtual play area — bars stay visible during the flash.
   */
  coverScreen?: boolean;
}

/**
 * Flash a solid color that decays from full opacity to zero over the
 * duration. The overlay is fully opaque at begin, so the scene swap happens
 * invisibly under the flash:
 * - push/replace: no visibility juggling — the incoming scene is already
 *   mounted on top of the outgoing one in the stage order, so as the
 *   overlay decays only the incoming scene shows through.
 * - pop: outgoing (top) scene is hidden from begin. Overlay masks the hide,
 *   and the destination beneath shows through as the flash tapers.
 */
export function flash(opts: FlashOptions = {}): SceneTransition {
  const duration = opts.duration ?? 200;
  const color = opts.color ?? 0xffffff;
  const coverScreen = opts.coverScreen ?? false;

  let overlay: Graphics | undefined;
  let fromContainer: Container | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const renderer = ctx.engineContext.resolve(RendererKey);
      overlay = new Graphics();
      if (coverScreen) {
        const { width, height } = renderer.application.screen;
        overlay.rect(0, 0, width, height);
        renderer.application.stage.addChild(overlay);
      } else {
        // `visibleCanvasRect` returns the full canvas extent in virtual
        // pixels — clipped to virtual under letterbox, extends into the
        // bars under expand.
        const r = renderer.visibleCanvasRect;
        overlay.rect(r.x, r.y, r.width, r.height);
        renderer.worldRoot.addChild(overlay);
      }
      overlay.fill({ color, alpha: 1 });
      overlay.alpha = 1;

      if (ctx.kind === "pop") {
        fromContainer = getSceneContainer(ctx, ctx.fromScene);
        if (fromContainer) fromContainer.visible = false;
      }
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!overlay) return;
      overlay.alpha = 1 - ctx.elapsed / duration;
    },
    end() {
      if (overlay) {
        overlay.destroy();
        overlay = undefined;
      }
      // Deliberately don't restore fromContainer — on pop it's about to be
      // destroyed and end() fires inside the tick's update phase before
      // PIXI renders, so restoring would paint the outgoing scene for one
      // last frame.
      fromContainer = undefined;
    },
  };
}
