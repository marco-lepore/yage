import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { getSceneContainer, getVirtualBounds } from "./helpers.js";

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
 * incoming scene's container is masked by a grid of cells that grow from
 * a center point to fill their slot — even-parity cells first, odd-parity
 * second — so the new scene "paints in" cell-by-cell on top of the
 * previous one. No blackout mid-point and no color overlay: the previous
 * scene stays visible underneath until each cell of the new scene covers it.
 *
 * - Even cells (`(row + col) & 1 === 0`): grow over `[0, 0.7]`
 * - Odd cells  (`(row + col) & 1 === 1`): grow over `[0.3, 1]`
 *
 * Pixi v8 Graphics masks are stencil clips (binary in/out, no alpha) —
 * scaling each cell from 0 to its full size with smoothstep easing produces
 * the soft per-cell entry that mask-fill alpha can't. The 0.4 overlap means
 * odd cells start growing while even cells are still mid-grow, removing the
 * "second wave pops in" jolt at the midpoint.
 *
 * On `pop` the destination scene is brought to the front of the scene
 * stack so the same mechanic applies — without it the outgoing scene
 * would render over the masked destination.
 */
export function chessboard(opts: ChessboardOptions = {}): SceneTransition {
  const duration = opts.duration ?? 700;
  const rows = Math.max(1, Math.floor(opts.rows ?? 6));
  const cols = Math.max(1, Math.floor(opts.cols ?? 10));

  let toContainer: Container | undefined;
  let maskGfx: Graphics | undefined;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      const provider = ctx.engineContext.resolve(SceneRenderTreeProviderKey);
      // Pop normally leaves the outgoing scene on top — bring the
      // destination to the front so its mask drives the visual reveal.
      // No-op for push/replace where the new scene is already topmost.
      if (ctx.toScene) provider.bringSceneToFront?.(ctx.toScene);

      toContainer = getSceneContainer(ctx, ctx.toScene);
      if (!toContainer) return;
      const { width, height } = getVirtualBounds(ctx);
      maskGfx = new Graphics();
      toContainer.addChild(maskGfx);
      toContainer.setMask({ mask: maskGfx, inverse: false });
      drawCells(maskGfx, width, height, rows, cols, 0);
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!maskGfx) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      const { width, height } = getVirtualBounds(ctx);
      drawCells(maskGfx, width, height, rows, cols, t);
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
      const s = cellScale(t, phase);
      if (s <= 0) continue;
      const w = cw * s;
      const h = ch * s;
      const x = c * cw + (cw - w) / 2;
      const y = r * ch + (ch - h) / 2;
      g.rect(x, y, w, h).fill({ color: 0xffffff });
    }
  }
}

function cellScale(t: number, phase: 0 | 1): number {
  const start = phase === 0 ? 0 : 0.3;
  const end = phase === 0 ? 0.7 : 1;
  if (t <= start) return 0;
  if (t >= end) return 1;
  const x = (t - start) / (end - start);
  return x * x * (3 - 2 * x);
}
