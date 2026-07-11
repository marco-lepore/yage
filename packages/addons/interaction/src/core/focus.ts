import type { FocusQuery, InteractCandidate } from "./types.js";

/**
 * Pure nearest-in-range focus selection. A candidate is in range when its
 * distance to `query.position` is `<= query.range + candidate.radius`. Among
 * in-range candidates, the winner is the highest `priority`; ties break by
 * nearest distance, then by lowest `order` (registration order) for a fully
 * deterministic result. Empty or all-out-of-range candidates return `null`.
 * Compares squared distances internally to avoid a `sqrt` per candidate.
 */
export function selectFocus<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C | null {
  let best: C | null = null;
  let bestDistanceSq = Infinity;

  for (const candidate of candidates) {
    const dx = query.position.x - candidate.position.x;
    const dy = query.position.y - candidate.position.y;
    const distanceSq = dx * dx + dy * dy;
    const reach = query.range + candidate.radius;
    if (distanceSq > reach * reach) continue;

    if (best === null) {
      best = candidate;
      bestDistanceSq = distanceSq;
      continue;
    }

    if (candidate.priority !== best.priority) {
      if (candidate.priority > best.priority) {
        best = candidate;
        bestDistanceSq = distanceSq;
      }
      continue;
    }

    if (distanceSq !== bestDistanceSq) {
      if (distanceSq < bestDistanceSq) {
        best = candidate;
        bestDistanceSq = distanceSq;
      }
      continue;
    }

    if (candidate.order < best.order) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }

  return best;
}
