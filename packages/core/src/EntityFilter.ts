import type { Entity } from "./Entity.js";
import type { TraitToken } from "./Trait.js";

/** Filter criteria for entity queries. All fields are AND'd together. */
export interface EntityFilter {
  /** Match entities whose class implements this trait. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trait?: TraitToken<any>;
  /** Match entities that have ALL of these tags. */
  tags?: string[];
  /** Match entities with this exact name. */
  name?: string;
  /** Custom predicate — called after other checks pass. */
  filter?: (entity: Entity) => boolean;
}

/** Apply a filter to an iterable of entities. Skips destroyed entities. */
export function filterEntities(
  entities: Iterable<Entity>,
  filter: EntityFilter,
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities) {
    if (entity.isDestroyed) continue;
    if (filter.name !== undefined && entity.name !== filter.name) continue;
    if (filter.tags) {
      let allMatch = true;
      for (const tag of filter.tags) {
        if (!entity.tags.has(tag)) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;
    }
    if (filter.trait && !entity.hasTrait(filter.trait)) continue;
    if (filter.filter && !filter.filter(entity)) continue;
    result.push(entity);
  }
  return result;
}
