import { Entity } from "./Entity.js";
import type { EntityCallbacks } from "./Entity.js";
import type { EngineContext } from "./EngineContext.js";
import type { QueryCache } from "./QueryCache.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import type { Prefab } from "./Prefab.js";
import type { Blueprint } from "./Blueprint.js";
import type { PrefabOverrides } from "./types.js";
import type { EventToken } from "./EventToken.js";
import { QueryCacheKey, EventBusKey } from "./EngineContext.js";

/**
 * Scenes own entities and define lifecycle hooks.
 * Each scene is a self-contained world with its own entity pool.
 */
export abstract class Scene {
  /** Name for debugging/inspection. */
  abstract readonly name: string;

  /** Whether scenes below this one in the stack should be paused. Default: true. */
  readonly pauseBelow: boolean = true;

  /** Whether scenes below this one should still render. Default: false. */
  readonly transparentBelow: boolean = false;

  private entities = new Set<Entity>();
  private destroyQueue: Entity[] = [];
  private _context!: EngineContext;
  private _paused = false;
  private entityCallbacks!: EntityCallbacks;
  private queryCache: QueryCache | undefined;
  private bus: EventBus<EngineEvents> | undefined;
  private _entityEventHandlers?: Map<
    string,
    Set<(data: never, entity: Entity) => void>
  >;

  /** Access the EngineContext. */
  get context(): EngineContext {
    return this._context;
  }

  /** Whether this scene is currently paused. */
  get paused(): boolean {
    return this._paused;
  }

  /** Spawn a new entity in this scene. */
  spawn(name?: string): Entity;
  spawn<P>(blueprint: Blueprint<P>, params: P): Entity;
  spawn(blueprint: Blueprint<void>): Entity;
  spawn(
    nameOrBlueprint?: string | Blueprint<unknown>,
    params?: unknown,
  ): Entity {
    const isBlueprint =
      typeof nameOrBlueprint === "object" &&
      nameOrBlueprint !== null &&
      "build" in nameOrBlueprint;

    const name = isBlueprint
      ? (nameOrBlueprint as Blueprint<unknown>).name
      : (nameOrBlueprint as string | undefined);

    const entity = new Entity(name);
    entity._setScene(this, this.entityCallbacks);
    this.entities.add(entity);
    this.bus?.emit("entity:created", { entity });

    if (isBlueprint) {
      (nameOrBlueprint as Blueprint<unknown>).build(entity, params);
    }

    return entity;
  }

  /** Spawn an entity from a prefab. */
  spawnPrefab(prefab: Prefab, overrides?: PrefabOverrides): Entity {
    return prefab.spawn(this, overrides);
  }

  /** Mark an entity for destruction. Deferred to endOfFrame flush. */
  destroyEntity(entity: Entity): void {
    entity.destroy();
  }

  /**
   * Add an entity to the destroy queue. Called by Entity.destroy().
   * @internal
   */
  _queueDestroy(entity: Entity): void {
    this.destroyQueue.push(entity);
  }

  /** Get all active entities. */
  getEntities(): ReadonlySet<Entity> {
    return this.entities;
  }

  /** Find entity by name (first match). */
  findEntity(name: string): Entity | undefined {
    for (const e of this.entities) {
      if (e.name === name && !e.isDestroyed) return e;
    }
    return undefined;
  }

  /** Find entities by tag. */
  findEntitiesByTag(tag: string): Entity[] {
    const result: Entity[] = [];
    for (const e of this.entities) {
      if (e.tags.has(tag) && !e.isDestroyed) result.push(e);
    }
    return result;
  }

  /** Subscribe to bubbled entity events at the scene level. Handler receives (data, emittingEntity). */
  on<T>(
    token: EventToken<T>,
    handler: (data: T, entity: Entity) => void,
  ): () => void {
    this._entityEventHandlers ??= new Map();
    let handlers = this._entityEventHandlers.get(token.name);
    if (!handlers) {
      handlers = new Set();
      this._entityEventHandlers.set(token.name, handlers);
    }
    handlers.add(handler as (data: never, entity: Entity) => void);

    return () => {
      handlers.delete(handler as (data: never, entity: Entity) => void);
    };
  }

  /**
   * Called by Entity.emit() for bubbling entity events to the scene.
   * @internal
   */
  _onEntityEvent(eventName: string, data: unknown, entity: Entity): void {
    const handlers = this._entityEventHandlers?.get(eventName);
    if (handlers) {
      for (const handler of [...handlers]) {
        (handler as (data: unknown, entity: Entity) => void)(data, entity);
      }
    }
  }

  // ---- Lifecycle hooks (override in subclasses) ----

  /** Called when the scene is entered. */
  onEnter?(): void;

  /** Called when the scene is exited (popped or replaced). */
  onExit?(): void;

  /** Called when a scene is pushed on top of this one. */
  onPause?(): void;

  /** Called when the scene above is popped, restoring this scene. */
  onResume?(): void;

  // ---- Internal methods ----

  /**
   * Set the engine context. Called by SceneManager when the scene is pushed.
   * @internal
   */
  _setContext(context: EngineContext): void {
    this._context = context;
    this.queryCache = context.tryResolve(QueryCacheKey) as
      | QueryCache
      | undefined;
    this.bus = context.tryResolve(EventBusKey) as
      | EventBus<EngineEvents>
      | undefined;

    this.entityCallbacks = {
      onComponentAdded: (entity, cls) => {
        this.queryCache?.onComponentAdded(entity);
        this.bus?.emit("component:added", {
          entity,
          component: entity.get(cls),
        });
      },
      onComponentRemoved: (entity, cls) => {
        this.queryCache?.onComponentRemoved(entity);
        this.bus?.emit("component:removed", { entity, componentClass: cls });
      },
    };
  }

  /**
   * Set paused state.
   * @internal
   */
  _setPaused(paused: boolean): void {
    this._paused = paused;
  }

  /**
   * Flush the destroy queue — destroy pending entities.
   * Called by the engine during the endOfFrame phase.
   * @internal
   */
  _flushDestroyQueue(): void {
    for (const entity of this.destroyQueue) {
      entity._performDestroy();
      this.queryCache?.onEntityDestroyed(entity);
      this.entities.delete(entity);
      this.bus?.emit("entity:destroyed", { entity });
    }
    this.destroyQueue.length = 0;
  }

  /**
   * Destroy all entities — used during scene exit.
   * @internal
   */
  _destroyAllEntities(): void {
    for (const entity of this.entities) {
      entity._performDestroy();
      this.queryCache?.onEntityDestroyed(entity);
    }
    this.entities.clear();
    this.destroyQueue.length = 0;
    this._entityEventHandlers?.clear();
  }
}
