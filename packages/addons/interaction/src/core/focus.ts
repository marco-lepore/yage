import type { FocusQuery, InteractCandidate } from "./types.js";

/**
 * Squared distance from `query.position` to the candidate when the candidate
 * is in range, else `null`. In range means `distance <= query.range +
 * candidate.radius`. Squared throughout to avoid a `sqrt` per candidate.
 */
function inRangeDistanceSq(query: FocusQuery, candidate: InteractCandidate): number | null {
  const dx = query.position.x - candidate.position.x;
  const dy = query.position.y - candidate.position.y;
  const distanceSq = dx * dx + dy * dy;
  const reach = query.range + candidate.radius;
  return distanceSq <= reach * reach ? distanceSq : null;
}

/**
 * Focus ordering shared by {@link selectInteractionFocus} and
 * {@link rankInteractables}: highest `priority` first, then nearest distance,
 * then lowest `order` (registration order) for a fully deterministic result.
 * Negative when `a` outranks `b`.
 */
function byFocusOrder(
  a: InteractCandidate,
  aDistanceSq: number,
  b: InteractCandidate,
  bDistanceSq: number,
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (aDistanceSq !== bDistanceSq) return aDistanceSq - bDistanceSq;
  return a.order - b.order;
}

/**
 * Pure nearest-in-range focus selection — the single winner, in O(n) with no
 * sort and no array allocation. Empty or all-out-of-range candidates return
 * `null`. Equivalent to `rankInteractables(query, candidates)[0] ?? null`;
 * reach for this one when a custom detector needs only the winner and would
 * otherwise pay for a sorted array it throws away.
 */
export function selectInteractionFocus<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C | null {
  let best: C | null = null;
  let bestDistanceSq = Infinity;

  for (const candidate of candidates) {
    const distanceSq = inRangeDistanceSq(query, candidate);
    if (distanceSq === null) continue;
    if (best === null || byFocusOrder(candidate, distanceSq, best, bestDistanceSq) < 0) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }

  return best;
}

/**
 * Pure ranking of every in-range candidate, best focus first — the same order
 * {@link selectInteractionFocus} picks its winner by, so
 * `rankInteractables(...)[0]` equals `selectInteractionFocus(...)`. Feeds a
 * "which of these do I interact with?" selection UI or a proximity highlight.
 * Out-of-range candidates are excluded; an empty or all-out-of-range input
 * returns `[]`.
 *
 * Geometry only — it has no notion of the `enabled` gate. Filter on
 * `isEnabled()` first when ranking a raw scene list.
 */
export function rankInteractables<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C[] {
  const scored: Array<{ candidate: C; distanceSq: number }> = [];
  for (const candidate of candidates) {
    const distanceSq = inRangeDistanceSq(query, candidate);
    if (distanceSq !== null) scored.push({ candidate, distanceSq });
  }
  scored.sort((a, b) => byFocusOrder(a.candidate, a.distanceSq, b.candidate, b.distanceSq));
  return scored.map((entry) => entry.candidate);
}
