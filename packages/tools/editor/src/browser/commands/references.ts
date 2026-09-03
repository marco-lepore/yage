import { describeParams, type LevelCatalog } from "@yagejs/level";
import type { JsonObject, LevelPlacement } from "@yagejs/level/document";

/** One reference parameter, and the placement it points at. */
export interface ReferenceUse {
  /** The placement holding the parameter. */
  readonly placementId: string;
  /** The parameter's name. */
  readonly field: string;
  readonly targetId: string;
}

/**
 * The names of the reference parameters a type declares, or none.
 *
 * The catalog is the only thing that knows which parameter is a reference —
 * the document stores an id string and nothing else — so every question about
 * references starts here. A type the catalog does not hold declares nothing
 * this editor can follow.
 */
export function referenceFieldNames(
  catalog: LevelCatalog | undefined,
  typeId: string,
): readonly string[] {
  const schema = catalog?.get(typeId)?.declaration.params;
  if (schema === undefined) return [];
  return describeParams(schema)
    .filter((field) => field.kind === "entityRef")
    .map((field) => field.name);
}

/**
 * Every reference from a placement outside `removing` to one inside it.
 *
 * This is what a delete has to ask about: removing the target leaves each of
 * these pointing at nothing. A reference from inside the removed set is not
 * one, because it goes away with the placement that holds it.
 */
export function inboundReferences(
  entities: readonly LevelPlacement[],
  removing: ReadonlySet<string>,
  fieldsOf: (typeId: string) => readonly string[],
): readonly ReferenceUse[] {
  const uses: ReferenceUse[] = [];
  for (const placement of entities) {
    if (removing.has(placement.id)) continue;
    for (const field of fieldsOf(placement.type)) {
      const value = Reflect.get(placement.params, field) as unknown;
      if (typeof value !== "string" || !removing.has(value)) continue;
      uses.push({ placementId: placement.id, field, targetId: value });
    }
  }
  return uses;
}

/**
 * `params` with each named field's id replaced, where `idFor` has a
 * replacement for it.
 *
 * A field the map does not cover keeps what it held, which is how a copied
 * placement goes on pointing at a target that was not copied with it.
 */
export function rewriteReferences(
  params: JsonObject,
  fields: readonly string[],
  idFor: ReadonlyMap<string, string>,
): JsonObject {
  let rewritten: JsonObject | undefined;
  for (const field of fields) {
    const value = Reflect.get(params, field) as unknown;
    if (typeof value !== "string") continue;
    const replacement = idFor.get(value);
    if (replacement === undefined) continue;
    rewritten ??= { ...params };
    Reflect.set(rewritten, field, replacement);
  }
  return rewritten ?? params;
}

/**
 * What a press can choose while a reference field is waiting: every placement
 * of an accepted type, and everything authored under one, mapped to the
 * placement a press there would choose.
 *
 * A child maps to the nearest accepted placement at or above it, so a press
 * anywhere on a door chooses the door however the door is built, and a door
 * parented under another door chooses itself. A placement with no accepted
 * placement above it is absent, which is what "cannot be chosen" means
 * everywhere else in this mode: the map's keys are exactly what stays lit,
 * exactly what the viewport hit-tests, and exactly what a hierarchy row picks.
 */
export function referenceTargets(
  entities: readonly LevelPlacement[],
  types: readonly string[],
): ReadonlyMap<string, string> {
  const accepted = new Set(types);
  const byId = new Map(entities.map((one) => [one.id, one]));
  const targets = new Map<string, string>();
  for (const placement of entities) {
    // A chain that loops stops where it started, the way every other walk over
    // this document treats one.
    const seen = new Set<string>();
    let current: LevelPlacement | undefined = placement;
    while (current !== undefined && !seen.has(current.id)) {
      if (accepted.has(current.type)) {
        targets.set(placement.id, current.id);
        break;
      }
      seen.add(current.id);
      current =
        current.parent === undefined ? undefined : byId.get(current.parent);
    }
  }
  return targets;
}
