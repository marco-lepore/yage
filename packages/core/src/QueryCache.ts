import type { Entity } from "./Entity.js";
import type { ComponentClass } from "./types.js";

/**
 * A filter used to register a query — an array of required component classes.
 * A class matches any subclass of it too, so `[Transform, VisualComponent]`
 * finds an entity carrying a `SpriteComponent`.
 */
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
 * Incrementally maintained entity sets based on component signatures. A
 * filter class matches the class itself and any subclass of it.
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
  /**
   * Every active entity in this cache's scene, for seeding new queries.
   * Dormant entities (`entity.isActive === false`) are excluded, so a query
   * registered while they sleep does not pick them up either.
   */
  private readonly liveEntities = new Set<Entity>();

  /**
   * Register a query. The returned result is pre-populated with currently
   * matching entities and then maintained incrementally as components are
   * added/removed and entities are destroyed.
   */
  register(filter: QueryFilter): QueryResult {
    const result = new QueryResult(filter);
    this.seed(result);
    this.queries.push(result);
    return result;
  }

  /**
   * Build a seeded `QueryResult` without registering it — a detached
   * point-in-time read for callers that must not register (e.g. render-phase
   * snapshots). It never receives updates. Use `register` for a live query.
   */
  queryOnce(filter: QueryFilter): QueryResult {
    const result = new QueryResult(filter);
    this.seed(result);
    return result;
  }

  /** Populate `result._entities` with currently matching live entities. */
  private seed(result: QueryResult): void {
    for (const e of this.liveEntities) {
      if (this.matches(e, result._filter)) result._entities.add(e);
    }
  }

  /**
   * Stop maintaining `result` — it no longer receives entity updates. A
   * second call (or a `result` that was never registered) is a no-op.
   */
  unregister(result: QueryResult): void {
    const idx = this.queries.indexOf(result);
    if (idx !== -1) this.queries.splice(idx, 1);
  }

  /**
   * Called by Entity when a component is added. A component added to a
   * dormant entity joins nothing — `onEntityActivated` picks the entity up
   * with its full component set when it wakes.
   */
  onComponentAdded(entity: Entity): void {
    if (!entity.isActive) return;
    this.join(entity);
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
    this.leave(entity);
  }

  /** Called when an entity becomes active — re-seeds its query membership. */
  onEntityActivated(entity: Entity): void {
    this.join(entity);
  }

  /** Called when an entity goes dormant — same removals as destruction. */
  onEntityDeactivated(entity: Entity): void {
    this.leave(entity);
  }

  private join(entity: Entity): void {
    this.liveEntities.add(entity);
    for (const q of this.queries) {
      if (this.matches(entity, q._filter)) {
        q._entities.add(entity);
      }
    }
  }

  private leave(entity: Entity): void {
    this.liveEntities.delete(entity);
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
