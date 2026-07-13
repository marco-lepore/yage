import type { Vec2 } from "@yagejs/core";

/** A cell coordinate on a `GridGraph`. */
export interface GridCell {
  col: number;
  row: number;
}

/** Result of `GridGraph.findPath`. */
export interface Path {
  /** Tile-centre waypoints in world pixels, start cell through goal cell. */
  waypoints: Vec2[];
  /** Cells the path passes through, parallel to `waypoints`. */
  cells: GridCell[];
  /** Total step cost (diagonal steps count `Math.SQRT2`, scaled by each destination cell's `cost`). */
  cost: number;
}

/**
 * `"never"` — 4-connected, orthogonal steps only.
 * `"always"` — 8-connected; diagonals allowed even when they cut a wall corner.
 * `"no-corner-cutting"` — 8-connected; a diagonal step is only allowed when
 * both shared orthogonal cells are walkable.
 */
export type DiagonalMovement = "never" | "always" | "no-corner-cutting";

export type HeuristicName = "manhattan" | "chebyshev" | "octile" | "euclidean";
