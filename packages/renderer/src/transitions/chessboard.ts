import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Application, Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { getSceneContainer } from "./helpers.js";

export interface ChessboardOptions {
  /** Total duration in ms. Default: 700. */
  duration?: number;
  /** Grid rows. Default: 6. */
  rows?: number;
  /** Grid columns. Default: 10. */
  cols?: number;
}

/**
 * Reveal the destination scene through a staggered checkerboard mask. The
 * incoming scene's container is masked by a grid of cells that fade in
 * over time — even-parity cells first, odd-parity second — so the new
 * scene "paints in" cell-by-cell on top of the previous one. No blackout
 * mid-point and no color overlay: the previous scene stays visible
 * underneath until each cell of the new scene covers it.
 *
 * - Even cells (`(row + col) & 1 === 0`): fade alpha 0→1 over `[0, 0.5]`
 * - Odd cells (`(row + col) & 1 === 1`):  fade alpha 0→1 over `[0.5, 1]`
 *
 * On `pop` the destination scene is brought to the front of the scene
 * stack so the same mechanic applies — without it the outgoing scene
 * would render over the masked destination.
 */
export function chessboard(opts: ChessboardOptions = {}): SceneTransition {
  const duration = opts.duration ?? 700;
  const rows = Math.max(1, Math.floor(opts.rows ?? 6));
  const cols = Math.max(1, Math.floor(opts.cols ?? 10));

  let app: Application | undefined;
  let toContainer: Container | undefined;
  let maskGfx: Graphics | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      app = ctx.engineContext.resolve(RendererKey).application;
      const provider = ctx.engineContext.resolve(SceneRenderTreeProviderKey);
      // Pop normally leaves the outgoing scene on top — bring the
      // destination to the front so its mask drives the visual reveal.
      // No-op for push/replace where the new scene is already topmost.
      if (ctx.toScene) provider.bringSceneToFront?.(ctx.toScene);

      toContainer = getSceneContainer(ctx, ctx.toScene);
      if (!toContainer) return;
      maskGfx = new Graphics();
      toContainer.addChild(maskGfx);
      toContainer.setMask({ mask: maskGfx, inverse: false });
      drawCells(maskGfx, app.screen.width, app.screen.height, rows, cols, 0);
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!maskGfx || !app) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      drawCells(maskGfx, app.screen.width, app.screen.height, rows, cols, t);
    },
    end() {
      // Direct assignment instead of `setMask({ mask: null })` — pixi v8's
      // setMask with null only updates the cached options and leaves the
      // live effect dangling on a destroyed mask. Same gotcha attachMask
      // documents at length.
      if (toContainer) toContainer.mask = null;
      if (maskGfx) {
        maskGfx.removeFromParent();
        maskGfx.destroy();
        maskGfx = undefined;
      }
      toContainer = undefined;
      app = undefined;
    },
  };
}

function drawCells(
  g: Graphics,
  width: number,
  height: number,
  rows: number,
  cols: number,
  t: number,
): void {
  g.clear();
  const cw = width / cols;
  const ch = height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const phase = ((r + c) & 1) as 0 | 1;
      const a = cellAlpha(t, phase);
      if (a <= 0) continue;
      g.rect(c * cw, r * ch, cw, ch).fill({ color: 0xffffff, alpha: a });
    }
  }
}

/**
 * Per-cell alpha for the staggered reveal. Phase 0 cells fade in over
 * `[0, 0.5]` and stay full; phase 1 cells fade in over `[0.5, 1]`. Both
 * end at full opacity so the mask fully covers the destination at `t=1`.
 */
export function cellAlpha(t: number, phase: 0 | 1): number {
  const start = phase === 0 ? 0 : 0.5;
  const end = phase === 0 ? 0.5 : 1;
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}
