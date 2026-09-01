import type {
  LevelDocument,
  LevelPlacement,
  LevelPoint,
  LevelTransform,
} from "@yagejs/level/document";
import {
  derivedSceneKey,
  type PlacementInsert,
} from "../../shared/commands/index.js";
import { placementById, selectionRoots, withDescendants } from "./graph.js";
import {
  parentFrame,
  parentWorld,
  toWorld,
  worldDeltaToLocal,
} from "./pose.js";

/** What to copy, where to put it, and how to name what comes out. */
export interface CloneRequest {
  /** The document the placements are read from. */
  readonly source: LevelDocument;
  /** The placements to copy. Anything under one of them comes too. */
  readonly ids: readonly string[];
  /** The document the copies are going into, which may be the source. */
  readonly destination: LevelDocument;
  /**
   * `duplicate` copies within one level and may keep a parent outside the
   * copied set. `paste` is going somewhere else and never does.
   */
  readonly mode: "duplicate" | "paste";
  /** Where the ids come from. Injected so a test can name them. */
  readonly newId: () => string;
  /** A world offset applied to every copied root, so copies are not hidden. */
  readonly offset?: LevelPoint;
}

/**
 * Copies of the named placements and everything under them, ready to insert.
 *
 * Every copy gets a fresh id, and a parent link inside the copied set follows
 * the copies, so a copied subtree keeps its own shape. A link out of the set is
 * where the two modes differ, and where a copy can lose its place:
 *
 * - `duplicate` keeps the outside parent when the destination still holds it,
 *   which is what makes duplicating a child produce a sibling of it.
 * - Otherwise the copy detaches and takes the world transform it had, so it
 *   lands where the original looked rather than where a local transform points
 *   once nothing composes onto it.
 *
 * Only the copied roots take the offset. Everything under one is positioned
 * relative to it and moves when it does, so offsetting a child as well would
 * move it twice and pull the subtree apart.
 *
 * Copies land after the last of their sources in the destination, so a
 * duplicate appears next to what it came from rather than at the end of a long
 * hierarchy. A paste from another level has no sources there and appends.
 */
export function clonePlacements(
  request: CloneRequest,
): readonly PlacementInsert[] {
  const roots = new Set(selectionRoots(request.source, request.ids));
  const copying = withDescendants(request.source.entities, [...roots]);
  if (copying.length === 0) return [];

  const idFor = new Map(copying.map((id) => [id, request.newId()]));
  const bySource = placementById(request.source);
  const keys = takenKeys(request.destination);
  const at = insertionIndex(request.destination, copying);

  return copying.map((oldId, offset) => {
    // `copying` and `idFor` are both built from the source's own placements,
    // so both lookups below resolve.
    const old = bySource.get(oldId);
    const id = idFor.get(oldId);
    if (!old || id === undefined) {
      throw new Error(`clone lost placement ${oldId}`);
    }
    const parent = parentFor(request, old, idFor);
    return {
      placement: {
        // Spread rather than listed field by field, so a field added to
        // `LevelPlacement` later is copied without this module being told.
        ...carriedFields(old),
        id,
        ...(old.key === undefined ? {} : { key: freeKey(old.key, keys) }),
        // A copy that detached carries no `parent` key at all. Setting one to
        // `undefined` is a different thing, and it would reach the file.
        ...(parent === undefined ? {} : { parent }),
        transform: transformFor(request, old, parent, roots.has(oldId)),
      },
      index: at + offset,
    };
  });
}

/**
 * A deep copy of everything the placement holds except its parent link, which
 * the copy works out for itself.
 */
function carriedFields(
  placement: LevelPlacement,
): Omit<LevelPlacement, "parent"> {
  const copy = structuredClone(placement);
  Reflect.deleteProperty(copy, "parent");
  return copy;
}

/** Which placement a copy hangs off, or nothing when it comes out detached. */
function parentFor(
  request: CloneRequest,
  old: LevelPlacement,
  idFor: ReadonlyMap<string, string>,
): string | undefined {
  if (old.parent === undefined) return undefined;
  const copied = idFor.get(old.parent);
  if (copied !== undefined) return copied;
  const keeps =
    request.mode === "duplicate" &&
    request.destination.entities.some((entry) => entry.id === old.parent);
  return keeps ? old.parent : undefined;
}

/**
 * The transform a copy is authored with.
 *
 * A copy that kept a parent keeps its local transform, because the same
 * composition still applies to it. One that lost a parent takes the world
 * transform it had, because nothing composes onto it any more.
 *
 * The offset is a world distance, so it goes through whatever frame the copy
 * ended up under — which for a detached or top-level copy is no frame at all.
 */
function transformFor(
  request: CloneRequest,
  old: LevelPlacement,
  parent: string | undefined,
  isRoot: boolean,
): LevelTransform {
  const detached = parent === undefined && old.parent !== undefined;
  const base = detached
    ? toWorld(old.transform, parentWorld(request.source, old.parent))
    : old.transform;
  const offset = isRoot ? request.offset : undefined;
  if (!offset) return base;
  const local =
    parent === undefined
      ? offset
      : worldDeltaToLocal(parentFrame(request.source, old.id), offset);
  return {
    ...base,
    position: { x: base.position.x + local.x, y: base.position.y + local.y },
  };
}

/** Where the copies go: after the last of their sources, or at the end. */
function insertionIndex(
  destination: LevelDocument,
  sources: readonly string[],
): number {
  const named = new Set(sources);
  let last = -1;
  destination.entities.forEach((entry, index) => {
    if (named.has(entry.id)) last = index;
  });
  return last === -1 ? destination.entities.length : last + 1;
}

/**
 * The scene keys a document already derives.
 *
 * Two placements deriving one scene key make the level refuse to load, so a
 * copy has to step clear of every key already in use — the authored ones and
 * the ids the placements without a key derive.
 */
function takenKeys(document: LevelDocument): Set<string> {
  return new Set(document.entities.map(derivedSceneKey));
}

/**
 * The key, or the first numbered variant of it nothing holds.
 *
 * A key that already ends in a number counts on from it, so duplicating
 * `door-1` and `door-2` gives `door-3` and `door-4` rather than `door-1-2` and
 * `door-2-2`.
 */
function freeKey(key: string, taken: Set<string>): string {
  const numbered = /^(.*?)-(\d+)$/.exec(key);
  const stem = numbered?.[1] ?? key;
  let candidate = key;
  let suffix = Number(numbered?.[2] ?? 1) + 1;
  while (taken.has(candidate)) {
    candidate = `${stem}-${String(suffix)}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}
