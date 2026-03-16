import { Entity } from "./Entity.js";
import type { EntityCallbacks } from "./Entity.js";
import type { EngineContext } from "./EngineContext.js";
import type { QueryCache } from "./QueryCache.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import type { Blueprint } from "./Blueprint.js";
import type { EventToken } from "./EventToken.js";
import type { AssetHandle } from "./AssetHandle.js";
import type { AssetManager } from "./AssetManager.js";
import type { ServiceKey } from "./EngineContext.js";
import {
  QueryCacheKey,
  EventBusKey,
  AssetManagerKey,
} from "./EngineContext.js";

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

  /** Asset handles to load before onEnter(). Override in subclasses. */
  readonly preload?: readonly AssetHandle<unknown>[];

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

  /** Convenience accessor for the AssetManager. */
  get assets(): AssetManager {
    return this._context.resolve(AssetManagerKey);
  }

  /**
   * Lazy proxy-based service resolution. Can be used at field-declaration time:
   * ```ts
   * readonly layers = this.service(RenderLayerManagerKey);
   * ```
   * The actual resolution is deferred until first property access.
   */
  protected service<T extends object>(key: ServiceKey<T>): T {
    let resolved: T | undefined;
    return new Proxy({} as object, {
      get: (_target, prop) => {
        resolved ??= this._context.resolve(key);
        const value = (resolved as Record<string | symbol, unknown>)[prop];
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(resolved)
          : value;
      },
      set: (_target, prop, value) => {
        resolved ??= this._context.resolve(key);
        (resolved as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }) as T;
  }

  /** Spawn a new entity in this scene. */
  spawn(name?: string): Entity;
  spawn<P>(blueprint: Blueprint<P>, params: P): Entity;
  spawn(blueprint: Blueprint<void>): Entity;
  /** Spawn an entity subclass with setup params. */
  spawn<E extends Entity, P>(
    Class: new () => E & { setup(params: P): void },
    params: P,
  ): E;
  /** Spawn an entity subclass without setup params. */
  spawn<E extends Entity>(Class: new () => E): E;
  spawn(
    nameOrBlueprintOrClass?: string | Blueprint<unknown> | (new () => Entity),
    params?: unknown,
  ): Entity {
    // Class-based spawn: argument is a constructor function for an Entity subclass
    if (typeof nameOrBlueprintOrClass === "function") {
      const entity = new nameOrBlueprintOrClass();
      entity._setScene(this, this.entityCallbacks);
      this.entities.add(entity);
      this.bus?.emit("entity:created", { entity });
      entity.setup?.(params);
      return entity;
    }

    const isBlueprint =
      typeof nameOrBlueprintOrClass === "object" &&
      nameOrBlueprintOrClass !== null &&
      "build" in nameOrBlueprintOrClass;

    const name = isBlueprint
      ? (nameOrBlueprintOrClass as Blueprint<unknown>).name
      : (nameOrBlueprintOrClass as string | undefined);

    const entity = new Entity(name);
    entity._setScene(this, this.entityCallbacks);
    this.entities.add(entity);
    this.bus?.emit("entity:created", { entity });

    if (isBlueprint) {
      (nameOrBlueprintOrClass as Blueprint<unknown>).build(entity, params);
    }

    return entity;
  }

  /**
   * Add an existing entity to this scene (used by Entity.addChild for auto-scene-membership).
   * @internal
   */
  _addExistingEntity(entity: Entity): void {
    entity._setScene(this, this.entityCallbacks);
    this.entities.add(entity);
    this.bus?.emit("entity:created", { entity });

    // Register pre-existing components with QueryCache
    if (!entity.getAll()[Symbol.iterator]().next().done) {
      this.queryCache?.onComponentAdded(entity);
    }
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

  /** Called during asset preloading with progress ratio (0→1). */
  onProgress?(ratio: number): void;

  /** Called when the scene is entered (after preload completes). */
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
