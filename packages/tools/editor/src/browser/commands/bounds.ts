/**
 * The rectangle the whole editor measures in.
 *
 * Arranging, the overlay, the reference guides, the box gizmo and framing the
 * view all answer questions about the same axis-aligned box, so the box and
 * the one operation over a set of them live apart from any of those.
 */

/** An axis-aligned rectangle in world space. */
export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The rectangle covering every one of `all`, or `undefined` when it is empty. */
export function unionBounds(
  all: Iterable<WorldBounds>,
): WorldBounds | undefined {
  let found: WorldBounds | undefined;
  for (const bounds of all) {
    found =
      found === undefined
        ? bounds
        : {
            minX: Math.min(found.minX, bounds.minX),
            minY: Math.min(found.minY, bounds.minY),
            maxX: Math.max(found.maxX, bounds.maxX),
            maxY: Math.max(found.maxY, bounds.maxY),
          };
  }
  return found;
}
