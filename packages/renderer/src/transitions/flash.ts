import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { getSceneRenderTree } from "./helpers.js";
import { createTransitionOverlay } from "./overlay.js";
import type { TransitionOverlay } from "./overlay.js";

export interface FlashOptions {
  /** Flash duration in seconds. Default: 0.2. */
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
  const duration = opts.duration ?? 0.2;
  const color = opts.color ?? 0xffffff;
  const coverScreen = opts.coverScreen ?? false;

  let overlay: TransitionOverlay | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      overlay = createTransitionOverlay(ctx, { coverScreen });
      const { x, y, width, height } = overlay.area;
      overlay.draw((g) => g.rect(x, y, width, height).fill({ color }));

      if (ctx.kind === "pop") {
        const fromTree = getSceneRenderTree(ctx, ctx.fromScene);
        if (fromTree) fromTree.visible = false;
      }
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!overlay) return;
      overlay.alpha = 1 - ctx.elapsed / duration;
    },
    end() {
      overlay?.destroy();
      overlay = undefined;
      // Deliberately don't restore the outgoing scene — on pop it's about
      // to be destroyed and end() fires inside the tick's update phase
      // before PIXI renders, so restoring would paint the outgoing scene
      // for one last frame.
    },
  };
}
