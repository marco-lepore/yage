import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Application, Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer } from "./helpers.js";

export interface FlashOptions {
  /** Flash duration in ms. Default: 200. */
  duration?: number;
  /** Flash color as a hex number. Default: 0xffffff. */
  color?: number;
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

  let overlay: Graphics | undefined;
  let app: Application | undefined;
  let fromContainer: Container | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      app = ctx.engineContext.resolve(RendererKey).application;
      overlay = new Graphics();
      overlay.rect(0, 0, app.screen.width, app.screen.height);
      overlay.fill({ color, alpha: 1 });
      overlay.alpha = 1;
      app.stage.addChild(overlay);

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
      app = undefined;
    },
  };
}
