import type { DiagonalMovement, HeuristicName } from "./types.js";

/** A heuristic takes non-negative cell-space deltas and estimates remaining cost. */
export type HeuristicFn = (dx: number, dy: number) => number;

export const heuristics: Record<HeuristicName, HeuristicFn> = {
  manhattan: (dx, dy) => dx + dy,
  chebyshev: (dx, dy) => Math.max(dx, dy),
  octile: (dx, dy) => {
    const min = Math.min(dx, dy);
    const max = Math.max(dx, dy);
    return max + (Math.SQRT2 - 1) * min;
  },
  euclidean: (dx, dy) => Math.sqrt(dx * dx + dy * dy),
};

/**
 * Resolves an explicit heuristic name, or picks the tight admissible default
 * for the diagonal policy: `octile` when diagonals are allowed, `manhattan`
 * otherwise.
 */
export function resolveHeuristic(
  name: HeuristicName | undefined,
  diagonalMovement: DiagonalMovement,
): HeuristicFn {
  if (name) return heuristics[name];
  return diagonalMovement === "never" ? heuristics.manhattan : heuristics.octile;
}
