import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import type { SceneRenderTree } from "../SceneRenderTree.js";
import { getSceneRenderTree } from "./helpers.js";
import { createTransitionOverlay } from "./overlay.js";
import type { TransitionOverlay } from "./overlay.js";

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

  let overlay: TransitionOverlay | undefined;
  let toTree: SceneRenderTree | undefined;
  let fromTree: SceneRenderTree | undefined;
  let crossedHalfway = false;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      overlay = createTransitionOverlay(ctx, { coverScreen });
      const { x, y, width, height } = overlay.area;
      overlay.draw((g) => g.rect(x, y, width, height).fill({ color }));
      overlay.alpha = 0;

      crossedHalfway = false;
      if (ctx.kind === "pop") {
        fromTree = getSceneRenderTree(ctx, ctx.fromScene);
      } else {
        toTree = getSceneRenderTree(ctx, ctx.toScene);
        if (toTree) toTree.visible = false;
      }
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!overlay) return;
      const t = ctx.elapsed / duration;
      overlay.alpha = t < 0.5 ? t * 2 : (1 - t) * 2;
      if (!crossedHalfway && t >= 0.5) {
        if (toTree) toTree.visible = true;
        if (fromTree) fromTree.visible = false;
        crossedHalfway = true;
      }
    },
    end() {
      overlay?.destroy();
      overlay = undefined;
      // Restore visibility on the incoming scene as a `clear()`-mid-run
      // safety net — the scene lives on and leaving it hidden would
      // corrupt state. Deliberately do NOT restore the outgoing scene: on
      // pop/replace it's about to be destroyed, but `end()` fires inside
      // the tick's update phase before PIXI renders — restoring visible
      // here would paint the outgoing scene for one last frame before
      // teardown, producing a visible "pop".
      if (toTree) toTree.visible = true;
      toTree = undefined;
      fromTree = undefined;
      crossedHalfway = false;
    },
  };
}
