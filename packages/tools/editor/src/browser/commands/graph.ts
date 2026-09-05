import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";

/**
 * The questions the editor asks about how placements are related.
 *
 * A level document is a flat list where each placement names its parent, so
 * every structural question — what is under this, is this inside that, which
 * of these is outermost — is a walk. They live together because the answers
 * have to agree: a reparent that refuses a drop uses the ancestor test, and
 * the delete that follows uses the descendant closure, and the two disagreeing
 * loses a subtree.
 *
 * A parent the document does not hold, and a chain that loops, are both
 * treated as the point the walk stopped at. The document layer refuses each
 * before a document reaches the store, so neither is a state to recover from.
 */

/**
 * Every placement by id, which every walk below starts from.
 *
 * The index is built once per document and held against it. A document is
 * replaced rather than edited — the store projects a new one from the
 * committed draft and the pending commands — so an index built for one stays
 * true for as long as anything can reach it. Without this the inspector builds
 * a fresh one per dragged placement, on every render of a drag.
 */
export function placementById(
  document: LevelDocument,
): ReadonlyMap<string, LevelPlacement> {
  const held = indexes.get(document);
  if (held) return held;
  const byId = new Map(
    document.entities.map((placement) => [placement.id, placement]),
  );
  indexes.set(document, byId);
  return byId;
}

const indexes = new WeakMap<
  LevelDocument,
  ReadonlyMap<string, LevelPlacement>
>();

/** Whether `id` is `candidate` or anywhere above it in the parent chain. */
export function isAncestorOrSelf(
  document: LevelDocument,
  id: string,
  candidate: string | undefined,
): boolean {
  const byId = placementById(document);
  const seen = new Set<string>();
  let current = candidate;
  while (current !== undefined && !seen.has(current)) {
    if (current === id) return true;
    seen.add(current);
    current = byId.get(current)?.parent;
  }
  return false;
}

/**
 * The named placements plus everything authored under them, in document order.
 *
 * Document order matters wherever the result is turned back into placements:
 * `remove-placements` inverts to an `add-placements` carrying each removed
 * placement's original index, and restoring them in that order is what puts
 * them back where they were.
 */
export function withDescendants(
  placements: readonly LevelPlacement[],
  ids: readonly string[],
): readonly string[] {
  const inside = new Set(
    ids.filter((id) => placements.some((placement) => placement.id === id)),
  );
  // Placements are not ordered parent-first, so one pass can miss a child
  // listed above its parent. Each pass that adds nothing is the last one.
  let growing = true;
  while (growing) {
    growing = false;
    for (const placement of placements) {
      if (placement.parent === undefined) continue;
      if (inside.has(placement.id) || !inside.has(placement.parent)) continue;
      inside.add(placement.id);
      growing = true;
    }
  }
  return placements
    .filter((placement) => inside.has(placement.id))
    .map((placement) => placement.id);
}

/**
 * The outermost of the named placements, in document order.
 *
 * One whose ancestor is also named is left out: an operation over a selection
 * acts on each root once, and a member that travels with its parent must not
 * also be acted on itself. Moving both would apply the parent's move twice to
 * the child, and cloning both would produce the child twice.
 */
export function selectionRoots(
  document: LevelDocument,
  ids: Iterable<string>,
): readonly string[] {
  const named = new Set(ids);
  const byId = placementById(document);
  return document.entities
    .filter((placement) => named.has(placement.id))
    .filter((placement) => !hasNamedAncestor(byId, named, placement))
    .map((placement) => placement.id);
}

/**
 * The parent every named placement sits under: its id, `null` for the top
 * level, and `undefined` when they do not all share one.
 *
 * Two questions rest on the answer and must not disagree: whether one
 * destination can reorder them, and whether one typed number means the same
 * thing for all of them. A local transform is read in its parent's frame, so a
 * selection spanning parents has no frame to type into. Both callers pass what
 * their own question is about — ordering passes the selection's roots, since a
 * selected child travels with its selected parent.
 *
 * An id the document does not hold is skipped, and naming none of them answers
 * `undefined`.
 */
export function sharedParent(
  document: LevelDocument,
  ids: Iterable<string>,
): string | null | undefined {
  const byId = placementById(document);
  let shared: string | null | undefined;
  let found = false;
  for (const id of ids) {
    const placement = byId.get(id);
    if (!placement) continue;
    const parent = placement.parent ?? null;
    if (!found) {
      shared = parent;
      found = true;
    } else if (parent !== shared) return undefined;
  }
  return found ? shared : undefined;
}

/**
 * The top-level placements whose subtree holds none of the named ones, in
 * document order.
 *
 * It is what isolating hides: everything the selection is not part of, named
 * at the outermost level so one entry stands for a whole tree. It walks up from
 * each named placement rather than down from every root.
 */
export function rootsWithout(
  document: LevelDocument,
  ids: Iterable<string>,
): readonly string[] {
  const byId = placementById(document);
  const holding = new Set<string>();
  for (const id of ids) {
    const root = rootOf(byId, id);
    if (root !== undefined) holding.add(root);
  }
  return document.entities
    .filter((placement) => placement.parent === undefined)
    .filter((placement) => !holding.has(placement.id))
    .map((placement) => placement.id);
}

/** The outermost ancestor of a placement, which is itself when it has none. */
function rootOf(
  byId: ReadonlyMap<string, LevelPlacement>,
  id: string,
): string | undefined {
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current !== undefined && !seen.has(current.id)) {
    if (current.parent === undefined) return current.id;
    seen.add(current.id);
    current = byId.get(current.parent);
  }
  return undefined;
}

function hasNamedAncestor(
  byId: ReadonlyMap<string, LevelPlacement>,
  named: ReadonlySet<string>,
  placement: LevelPlacement,
): boolean {
  const seen = new Set<string>([placement.id]);
  let current = placement.parent;
  while (current !== undefined && !seen.has(current)) {
    if (named.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.parent;
  }
  return false;
}

/** One placement and the placements authored under it. */
export interface PlacementNode {
  readonly placement: LevelPlacement;
  readonly children: readonly PlacementNode[];
}

/**
 * The document as a tree, roots in document order and each placement's
 * children in theirs.
 *
 * A placement whose parent is not in the document does not appear: the
 * document layer refuses one, and dropping it here is what keeps the tree a
 * tree rather than growing a second set of roots nobody asked for.
 */
export function placementTree(
  document: LevelDocument,
): readonly PlacementNode[] {
  const childrenOf = new Map<string, LevelPlacement[]>();
  const roots: LevelPlacement[] = [];
  for (const placement of document.entities) {
    if (placement.parent === undefined) {
      roots.push(placement);
      continue;
    }
    const siblings = childrenOf.get(placement.parent) ?? [];
    siblings.push(placement);
    childrenOf.set(placement.parent, siblings);
  }
  const node = (placement: LevelPlacement): PlacementNode => ({
    placement,
    children: (childrenOf.get(placement.id) ?? []).map(node),
  });
  return roots.map(node);
}

/**
 * The placements put out of the way and everything authored under one: the
 * set every consumer of hiding works from, so a hidden parent takes its
 * children with it without their ids being in the store. The one place that
 * answers it, for the viewport and the hierarchy alike.
 */
export function hiddenClosure(
  document: LevelDocument,
  hidden: ReadonlySet<string>,
): ReadonlySet<string> {
  if (hidden.size === 0) return hidden;
  return new Set(withDescendants(document.entities, [...hidden]));
}
