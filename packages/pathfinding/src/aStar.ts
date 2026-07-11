import { BinaryHeap } from "./BinaryHeap.js";
import type { HeuristicFn } from "./heuristics.js";
import type { DiagonalMovement, GridCell } from "./types.js";

export interface AStarOptions {
  cols: number;
  rows: number;
  startCol: number;
  startRow: number;
  goalCol: number;
  goalRow: number;
  /** Not consulted for the start cell — only for cells the search steps into. */
  isWalkable: (col: number, row: number) => boolean;
  cost: (col: number, row: number) => number;
  diagonalMovement: DiagonalMovement;
  heuristic: HeuristicFn;
}

export interface AStarResult {
  /** Start cell through goal cell, inclusive. */
  cells: GridCell[];
  cost: number;
}

interface OpenNode {
  index: number;
  g: number;
  h: number;
  f: number;
}

const ORTHOGONAL_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const DIAGONAL_OFFSETS: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/**
 * Grid A* over cell indices. The caller (`GridGraph`) owns edge-case
 * handling (bounds, same-cell, goal walkability) — this only searches.
 * Ties break on lower `f`, then lower `h`, then insertion order (via
 * `BinaryHeap`'s built-in FIFO tie-break), so identical inputs always
 * produce identical output.
 */
export function aStar(options: AStarOptions): AStarResult | null {
  const { cols, rows, startCol, startRow, goalCol, goalRow, isWalkable, cost, diagonalMovement, heuristic } =
    options;

  const startIndex = startRow * cols + startCol;
  const goalIndex = goalRow * cols + goalCol;

  if (startIndex === goalIndex) {
    return { cells: [{ col: startCol, row: startRow }], cost: 0 };
  }

  const size = cols * rows;
  const gScore = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  gScore[startIndex] = 0;

  const open = new BinaryHeap<OpenNode>((a, b) => (a.f !== b.f ? a.f - b.f : a.h - b.h));
  const startH = heuristic(Math.abs(goalCol - startCol), Math.abs(goalRow - startRow));
  open.push({ index: startIndex, g: 0, h: startH, f: startH });

  const offsets =
    diagonalMovement === "never" ? ORTHOGONAL_OFFSETS : [...ORTHOGONAL_OFFSETS, ...DIAGONAL_OFFSETS];

  let node: OpenNode | undefined;
  while ((node = open.pop()) !== undefined) {
    if (closed[node.index]) continue; // stale entry superseded by a cheaper one
    if (node.index === goalIndex) {
      return { cells: reconstructPath(parent, goalIndex, cols), cost: gScore[goalIndex]! };
    }
    closed[node.index] = 1;

    const col = node.index % cols;
    const row = (node.index - col) / cols;

    for (const [dc, dr] of offsets) {
      const nCol = col + dc;
      const nRow = row + dr;
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;
      if (!isWalkable(nCol, nRow)) continue;

      const isDiagonal = dc !== 0 && dr !== 0;
      if (
        isDiagonal &&
        diagonalMovement === "no-corner-cutting" &&
        (!isWalkable(col + dc, row) || !isWalkable(col, row + dr))
      ) {
        continue;
      }

      const nIndex = nRow * cols + nCol;
      if (closed[nIndex]) continue;

      const stepCost = (isDiagonal ? Math.SQRT2 : 1) * cost(nCol, nRow);
      const tentativeG = node.g + stepCost;
      if (tentativeG < gScore[nIndex]!) {
        gScore[nIndex] = tentativeG;
        parent[nIndex] = node.index;
        const h = heuristic(Math.abs(goalCol - nCol), Math.abs(goalRow - nRow));
        open.push({ index: nIndex, g: tentativeG, h, f: tentativeG + h });
      }
    }
  }

  return null;
}

function reconstructPath(parent: Int32Array, goalIndex: number, cols: number): GridCell[] {
  const cells: GridCell[] = [];
  let index = goalIndex;
  for (;;) {
    const col = index % cols;
    const row = (index - col) / cols;
    cells.unshift({ col, row });
    const p = parent[index]!;
    if (p === -1) break;
    index = p;
  }
  return cells;
}
