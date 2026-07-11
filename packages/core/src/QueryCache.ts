import type { Entity } from "./Entity.js";
import type { ComponentClass } from "./types.js";

/** A filter used to register a query — an array of required component classes. */
export type QueryFilter = readonly ComponentClass[];

/** A live, iterable set of entities matching a query filter. */
export class QueryResult {
  /** @internal */
  readonly _entities = new Set<Entity>();
  /** @internal */
  readonly _filter: QueryFilter;

  /** @internal */
  constructor(filter: QueryFilter) {
    this._filter = filter;
  }

  /** Iterate matching entities. */
  [Symbol.iterator](): Iterator<Entity> {
    return this._entities[Symbol.iterator]();
  }

  /** Number of matching entities. */
  get size(): number {
    return this._entities.size;
  }

  /** Get the first match (useful for singleton queries). */
  get first(): Entity | undefined {
    for (const e of this._entities) return e;
    return undefined;
  }

  /** Convert to array (allocates). */
  toArray(): Entity[] {
    return [...this._entities];
  }
}

/**
 * Incrementally maintained entity sets based on component signatures.
 *
 * Registrations made once at system-install time (e.g. `DisplaySystem`,
 * `UILayoutSystem`) are intentionally engine-lifetime and never unregistered
 * — those queries are meant to live as long as the engine does. Per-mount
 * registrations (e.g. `useQuery`) must call {@link unregister} when done, or
 * the query keeps receiving `onComponentAdded`/`onComponentRemoved` updates
 * forever.
 */
export class QueryCache {
  private queries: QueryResult[] = [];

  /** Register a query. Returns a stable reference to a live result set. */
  register(filter: QueryFilter): QueryResult {
    const result = new QueryResult(filter);
    this.queries.push(result);
    return result;
  }

  /**
   * Stop maintaining `result` — it no longer receives entity updates. A
   * second call (or a `result` that was never registered) is a no-op.
   */
  unregister(result: QueryResult): void {
    const idx = this.queries.indexOf(result);
    if (idx !== -1) this.queries.splice(idx, 1);
  }

  /** Called by Entity when a component is added. */
  onComponentAdded(entity: Entity): void {
    for (const q of this.queries) {
      if (this.matches(entity, q._filter)) {
        q._entities.add(entity);
      }
    }
  }

  /** Called by Entity when a component is removed. */
  onComponentRemoved(entity: Entity): void {
    for (const q of this.queries) {
      if (!this.matches(entity, q._filter)) {
        q._entities.delete(entity);
      }
    }
  }

  /** Called when an entity is destroyed. */
  onEntityDestroyed(entity: Entity): void {
    for (const q of this.queries) {
      q._entities.delete(entity);
    }
  }

  private matches(entity: Entity, filter: QueryFilter): boolean {
    for (const cls of filter) {
      if (!entity.has(cls)) return false;
    }
    return true;
  }
}
