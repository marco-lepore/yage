import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer } from "./helpers.js";

export interface FadeOptions {
  /** Fade duration in seconds. Default: 0.3. */
  duration?: number;
  /** Fill color as a hex number. Default: 0x000000. */
  color?: number;
  /**
   * When `true`, the overlay covers the full canvas including
   * letterbox / expand bars. When `false` (default), it covers only the
   * virtual play area — bars stay visible during the dip.
   */
  coverScreen?: boolean;
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
  const duration = opts.duration ?? 0.3;
  const color = opts.color ?? 0x000000;
  const coverScreen = opts.coverScreen ?? false;

  let overlay: Graphics | undefined;
  let toContainer: Container | undefined;
  let fromContainer: Container | undefined;
  let crossedHalfway = false;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const renderer = ctx.engineContext.resolve(RendererKey);
      overlay = new Graphics();
      if (coverScreen) {
        // `app.stage` sits at identity, so its children operate in canvas
        // pixels — sized to cover the bars too.
        const { width, height } = renderer.application.screen;
        overlay.rect(0, 0, width, height);
        renderer.application.stage.addChild(overlay);
      } else {
        // Size against `visibleCanvasRect` (canvas extent in virtual-px
        // coords). Under letterbox the worldRoot mask clips the overshoot
        // back to virtual; under expand there's no mask, so the overlay
        // paints into the bars too — exactly what `expand` games want.
        const r = renderer.visibleCanvasRect;
        overlay.rect(r.x, r.y, r.width, r.height);
        renderer.worldRoot.addChild(overlay);
      }
      overlay.fill({ color, alpha: 1 });
      overlay.alpha = 0;

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
    },
  };
}
