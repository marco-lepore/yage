import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Application, Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer } from "./helpers.js";

export interface FadeOptions {
  /** Fade duration in ms. Default: 300. */
  duration?: number;
  /** Fill color as a hex number. Default: 0x000000. */
  color?: number;
}

/**
 * Fade to a solid color, then fade back in. The fade-out takes the first
 * half of the duration, the fade-in takes the second half. The scene swap
 * happens when the overlay is fully opaque:
 * - push/replace: incoming scene stays hidden until the half-way mark, then
 *   is revealed underneath the decaying overlay.
 * - pop: outgoing scene stays visible through the fade-out, then is hidden
 *   at the half-way mark so the destination shows through during fade-in.
 *
 * Without this, pop would render the outgoing scene the whole way through
 * and "pop" suddenly to the destination once the stack is popped at end().
 */
export function fade(opts: FadeOptions = {}): SceneTransition {
  const duration = opts.duration ?? 300;
  const color = opts.color ?? 0x000000;

  let overlay: Graphics | undefined;
  let app: Application | undefined;
  let toContainer: Container | undefined;
  let fromContainer: Container | undefined;
  let crossedHalfway = false;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      app = ctx.engineContext.resolve(RendererKey).application;
      overlay = new Graphics();
      overlay.rect(0, 0, app.screen.width, app.screen.height);
      overlay.fill({ color, alpha: 1 });
      overlay.alpha = 0;
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
      if (!overlay) return;
      const t = ctx.elapsed / duration;
      overlay.alpha = t < 0.5 ? t * 2 : (1 - t) * 2;
      if (!crossedHalfway && t >= 0.5) {
        if (toContainer) toContainer.visible = true;
        if (fromContainer) fromContainer.visible = false;
        crossedHalfway = true;
      }
    },
    end() {
      if (overlay) {
        overlay.destroy();
        overlay = undefined;
      }
      // Restore visibility on the incoming scene as a `clear()`-mid-run
      // safety net — the scene lives on and leaving it hidden would
      // corrupt state. Deliberately do NOT restore `fromContainer`: on
      // pop/replace it's about to be destroyed, but `end()` fires inside
      // the tick's update phase before PIXI renders — restoring visible
      // here would paint the outgoing scene for one last frame before
      // teardown, producing a visible "pop".
      if (toContainer) toContainer.visible = true;
      toContainer = undefined;
      fromContainer = undefined;
      crossedHalfway = false;
      app = undefined;
    },
  };
}
