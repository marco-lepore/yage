import { Vec2 } from "@yagejs/core";
import type { FocusQuery, InteractCandidate } from "./types.js";

/**
 * Pure nearest-in-range focus selection. A candidate is in range when its
 * distance to `query.position` is `<= query.range + candidate.radius`. Among
 * in-range candidates, the winner is the highest `priority`; ties break by
 * nearest distance, then by lowest `order` (registration order) for a fully
 * deterministic result. Empty or all-out-of-range candidates return `null`.
 */
export function selectFocus<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C | null {
  let best: C | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = Vec2.distance(query.position, candidate.position);
    if (distance > query.range + candidate.radius) continue;

    if (best === null) {
      best = candidate;
      bestDistance = distance;
      continue;
    }

    if (candidate.priority !== best.priority) {
      if (candidate.priority > best.priority) {
        best = candidate;
        bestDistance = distance;
      }
      continue;
    }

    if (distance !== bestDistance) {
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
      continue;
    }

    if (candidate.order < best.order) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}
