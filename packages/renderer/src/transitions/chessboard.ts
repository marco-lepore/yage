import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { Application, Container } from "pixi.js";
import { RendererKey } from "../types.js";
import { getSceneContainer } from "./helpers.js";

export interface ChessboardOptions {
  /** Total duration in ms. Default: 700. */
  duration?: number;
  /** Grid rows. Default: 6. */
  rows?: number;
  /** Grid columns. Default: 10. */
  cols?: number;
  /** Cell color. Default: 0x000000. */
  color?: number;
}

/**
 * Stagger a checkerboard of cells over the screen, fully covering the
 * outgoing scene by the mid-point and uncovering the destination over
 * the second half. Even-parity cells lead by a quarter of the duration,
 * odd-parity cells follow — producing the classic two-pass chessboard wipe.
 *
 * Each cell ramps from alpha 0 → 1 → 1 → 0 over its assigned slice of
 * the timeline:
 * - Even cells (`(row + col) & 1 === 0`):  up [0, 0.25], hold [0.25, 0.5],  down [0.5, 0.75]
 * - Odd cells (`(row + col) & 1 === 1`):   up [0.25, 0.5], hold [0.5, 0.75], down [0.75, 1]
 *
 * The scene swap happens at `t = 0.5`, when both parities are at full
 * opacity and the screen is fully covered — same midpoint hand-off used
 * by `fade`.
 */
export function chessboard(opts: ChessboardOptions = {}): SceneTransition {
  const duration = opts.duration ?? 700;
  const rows = Math.max(1, Math.floor(opts.rows ?? 6));
  const cols = Math.max(1, Math.floor(opts.cols ?? 10));
  const color = opts.color ?? 0x000000;

  let app: Application | undefined;
  let overlay: Graphics | undefined;
  let toContainer: Container | undefined;
  let fromContainer: Container | undefined;
  let crossedHalfway = false;

  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      app = ctx.engineContext.resolve(RendererKey).application;
      overlay = new Graphics();
      app.stage.addChild(overlay);
      crossedHalfway = false;
      if (ctx.kind === "pop") {
        fromContainer = getSceneContainer(ctx, ctx.fromScene);
      } else {
        toContainer = getSceneContainer(ctx, ctx.toScene);
        if (toContainer) toContainer.visible = false;
      }
      drawCells(overlay, app.screen.width, app.screen.height, rows, cols, color, 0);
    },
    tick(_dt: number, ctx: SceneTransitionContext) {
      if (!overlay || !app) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      drawCells(
        overlay,
        app.screen.width,
        app.screen.height,
        rows,
        cols,
        color,
        t,
      );
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
      // Mid-run-clear safety net (fromContainer survives on pop and would
      // be left invisible by the half-way swap above).
      if (toContainer) toContainer.visible = true;
      toContainer = undefined;
      fromContainer = undefined;
      crossedHalfway = false;
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
  color: number,
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
      g.rect(c * cw, r * ch, cw, ch).fill({ color, alpha: a });
    }
  }
}

/**
 * Per-cell alpha curve. Phase 0 leads by a quarter; phase 1 trails. Both
 * parities are simultaneously at alpha 1 across `[0.5, 0.5]` so the
 * mid-point swap is fully obscured.
 */
export function cellAlpha(t: number, phase: 0 | 1): number {
  const upStart = phase === 0 ? 0 : 0.25;
  const upEnd = phase === 0 ? 0.25 : 0.5;
  const downStart = phase === 0 ? 0.5 : 0.75;
  const downEnd = phase === 0 ? 0.75 : 1;
  if (t <= upStart) return 0;
  if (t < upEnd) return (t - upStart) / (upEnd - upStart);
  if (t < downStart) return 1;
  if (t < downEnd) return 1 - (t - downStart) / (downEnd - downStart);
  return 0;
}
