import { Vec2, type Vec2Like } from "@yagejs/core";
import { aStar } from "./aStar.js";
import { resolveHeuristic } from "./heuristics.js";
import type { DiagonalMovement, GridCell, HeuristicName, Path } from "./types.js";

export interface GridGraphOptions {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  /**
   * Called on every `findPath`, never cached — a predicate whose result
   * changes between calls (a door opening) changes the next path with no
   * rebuild.
   */
  isWalkable: (col: number, row: number) => boolean;
  /**
   * Per-cell multiplier on the step entering that cell. Default `() => 1`.
   * Must return `>= 1` for optimal paths — the heuristic assumes a minimum
   * cell cost of 1, so sub-1 costs make it overestimate (a path is still
   * returned, just not guaranteed shortest).
   */
  cost?: (col: number, row: number) => number;
  /** Default `"no-corner-cutting"`. */
  diagonalMovement?: DiagonalMovement;
  /** Default: `"octile"` when diagonals are allowed, else `"manhattan"`. */
  heuristic?: HeuristicName;
  /** World-pixel position of cell `(0,0)`'s top-left corner. Default `(0,0)`. */
  origin?: Vec2Like;
}

const DEFAULT_COST = (): number => 1;

/** A grid graph with A* search. Coordinates in and out are world pixels. */
export class GridGraph {
  readonly cols: number;
  readonly rows: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly origin: Vec2;

  private readonly isWalkableFn: (col: number, row: number) => boolean;
  private readonly costFn: (col: number, row: number) => number;
  private readonly diagonalMovement: DiagonalMovement;
  private readonly heuristicFn: (dx: number, dy: number) => number;

  constructor(options: GridGraphOptions) {
    if (options.tileWidth <= 0 || options.tileHeight <= 0) {
      // Zero divides to NaN in worldToCell; negative silently mirrors it.
      throw new RangeError("GridGraph: tileWidth and tileHeight must be positive");
    }
    this.cols = options.cols;
    this.rows = options.rows;
    this.tileWidth = options.tileWidth;
    this.tileHeight = options.tileHeight;
    this.origin = options.origin ? new Vec2(options.origin.x, options.origin.y) : Vec2.ZERO;
    this.isWalkableFn = options.isWalkable;
    this.costFn = options.cost ?? DEFAULT_COST;
    this.diagonalMovement = options.diagonalMovement ?? "no-corner-cutting";
    this.heuristicFn = resolveHeuristic(options.heuristic, this.diagonalMovement);
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  worldToCell(v: Vec2Like): GridCell {
    return {
      col: Math.floor((v.x - this.origin.x) / this.tileWidth),
      row: Math.floor((v.y - this.origin.y) / this.tileHeight),
    };
  }

  /** Tile centre, in world pixels. */
  cellToWorld(col: number, row: number): Vec2 {
    return new Vec2(
      this.origin.x + (col + 0.5) * this.tileWidth,
      this.origin.y + (row + 0.5) * this.tileHeight,
    );
  }

  /**
   * Start/goal are world pixels, converted via `worldToCell`. Returns `null`
   * when either cell is out of bounds, or the goal cell isn't walkable (the
   * start cell may be blocked — an agent can straddle a blocked edge; only
   * the goal must be walkable). Same start/goal cell returns a one-waypoint,
   * zero-cost path regardless of that cell's walkability.
   */
  findPath(startWorld: Vec2Like, goalWorld: Vec2Like): Path | null {
    const start = this.worldToCell(startWorld);
    const goal = this.worldToCell(goalWorld);

    if (!this.inBounds(start.col, start.row) || !this.inBounds(goal.col, goal.row)) {
      return null;
    }

    const sameCell = start.col === goal.col && start.row === goal.row;
    if (!sameCell && !this.isWalkableFn(goal.col, goal.row)) {
      return null;
    }

    const result = aStar({
      cols: this.cols,
      rows: this.rows,
      startCol: start.col,
      startRow: start.row,
      goalCol: goal.col,
      goalRow: goal.row,
      isWalkable: this.isWalkableFn,
      cost: this.costFn,
      diagonalMovement: this.diagonalMovement,
      heuristic: this.heuristicFn,
    });
    if (!result) return null;

    return {
      cells: result.cells,
      waypoints: result.cells.map((c) => this.cellToWorld(c.col, c.row)),
      cost: result.cost,
    };
  }
}
