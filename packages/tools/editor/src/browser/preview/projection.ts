import type { PreparedLevel, PreparedPlacement } from "@yagejs/level";

/**
 * The most strict loads one document is worth attempting. Each failed attempt
 * removes at least one placement, so a document is exhausted after as many
 * attempts as it has placements, plus the one that succeeds. The ceiling
 * bounds the work a very large broken document can cost.
 */
export const MAX_PREVIEW_ATTEMPTS = 32;

export interface ProjectionOutcome<T> {
  /** Absent when every attempt failed. */
  readonly built?: T;
  /** Placements left out, whether they failed themselves or depend on one that did. */
  readonly excluded: ReadonlySet<string>;
  readonly attempts: number;
}

/** What a failed attempt says about which placement caused it. */
export interface AttemptFailure {
  readonly placementId?: string | undefined;
  readonly message: string;
}

/**
 * Build a preview from as much of a document as loads.
 *
 * The loader is strict on purpose: it either builds a whole document or
 * nothing. An editor cannot work that way — a document being edited is broken
 * most of the time — so it calls the strict loader over a subset, and each
 * failure removes the placement that caused it and the placements that cannot
 * exist without it. What comes back is the largest subset that loads, and the
 * ids that did not make it.
 *
 * `attempt` is passed a subset and either returns the built preview or throws
 * a failure naming one placement. A failure that names none ends the loop:
 * removing an arbitrary placement would not make it more likely to succeed.
 */
export function buildBestEffort<T>(
  prepared: PreparedLevel,
  initiallyExcluded: Iterable<string>,
  attempt: (subset: PreparedLevel) => T,
  describeFailure: (error: unknown) => AttemptFailure | undefined,
): ProjectionOutcome<T> {
  const excluded = new Set(initiallyExcluded);
  closeDependents(prepared.placements, excluded);
  const maxAttempts = Math.min(
    prepared.placements.length + 1,
    MAX_PREVIEW_ATTEMPTS,
  );
  let attempts = 0;

  while (attempts < maxAttempts) {
    const subset = subsetOf(prepared, excluded);
    // Nothing left to build. Loading an empty subset would succeed and put an
    // empty instance in the scene, which is what the caller already has.
    if (subset.placements.length === 0) break;
    attempts += 1;
    try {
      return { built: attempt(subset), excluded, attempts };
    } catch (error) {
      const failure = describeFailure(error);
      if (failure?.placementId === undefined) throw error;
      excluded.add(failure.placementId);
      closeDependents(prepared.placements, excluded);
    }
  }
  return { excluded, attempts };
}

/**
 * Exclude every placement that cannot load without an excluded one. A child
 * whose parent is gone has nothing to be positioned against, and a placement
 * whose reference target is gone would decode to a handle on nothing; the
 * loader refuses both.
 *
 * An optional reference is closed over as well. A handle that resolves in the
 * game and not in the preview would send `setup()` down a different branch in
 * the editor than in the running level, which is the divergence the preview
 * must not have.
 */
export function closeDependents(
  placements: readonly PreparedPlacement[],
  excluded: Set<string>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of placements) {
      if (excluded.has(entry.placement.id)) continue;
      if (!dependsOnExcluded(entry, excluded)) continue;
      excluded.add(entry.placement.id);
      changed = true;
    }
  }
}

function dependsOnExcluded(
  entry: PreparedPlacement,
  excluded: ReadonlySet<string>,
): boolean {
  const parent = entry.placement.parent;
  if (parent !== undefined && excluded.has(parent)) return true;
  return entry.references.some((one) => excluded.has(one.targetId));
}

/** The prepared level minus the excluded placements, ready for a strict load. */
export function subsetOf(
  prepared: PreparedLevel,
  excluded: ReadonlySet<string>,
): PreparedLevel {
  return {
    document: prepared.document,
    placements: prepared.placements.filter(
      (entry) => !excluded.has(entry.placement.id),
    ),
    // The subset is what remains after every known problem was removed, and
    // the strict loader refuses a prepared level carrying any diagnostic.
    diagnostics: [],
  };
}
