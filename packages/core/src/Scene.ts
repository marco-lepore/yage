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
import type { SnapshotResolver } from "./Serializable.js";
import type { SceneTransition } from "./SceneTransition.js";
import { filterEntities } from "./EntityFilter.js";
import type { EntityFilter } from "./EntityFilter.js";
import type { TraitToken } from "./Trait.js";
import {
  QueryCacheKey,
  EventBusKey,
  AssetManagerKey,
  SceneManagerKey,
} from "./EngineContext.js";

/**
 * Options accepted by the trailing argument of `Scene.spawn` and
 * `Entity.spawnChild`.
 */
export interface SpawnOptions {
  /**
   * Stable per-scene identity key. Looked up via `Scene.findByKey` and used
   * as a stable id in persistent stores (e.g. `defineSet<string>("world.opened")`).
   *
   * Identity is opt-in — most entities (bullets, particles, transient enemies)
   * never need a key. Pass one only for entities whose state should persist
   * across save/load or cross-scene navigation, or that game code looks up
   * by name (chests, doors, named NPCs).
   *
   * Heads-up: don't name a top-level setup-params field `key`. The 2-arg
   * `spawn(Class, X)` form looks at `X`'s shape to disambiguate params from
   * options — an `X` whose only own keys are SpawnOptions fields routes
   * to options. If your params shape clashes (e.g. `setup(p: { key: number })`),
   * use the explicit 3-arg form `spawn(Class, params, options)`.
   */
  key?: string;
}

/**
 * Heuristic: is this object exactly the shape of `SpawnOptions`? Used by the
 * runtime to disambiguate the 2-arg `spawn(Class, X)` / `spawn(Blueprint, X)`
 * forms when both params and options are plausible.
 *
 * Rule: a plain object whose only own keys are SpawnOptions fields. As of
 * today, that's just `key`. If `SpawnOptions` grows, extend the allow-list.
 *
 * Trade-off: a params shape with a top-level `key` and nothing else is
 * misrouted to options — the "reserved-keys-in-options" footgun called out
 * in the design memo. Mitigation: don't name a top-level setup-params field
 * `key`. Use the 3-arg form (`spawn(Class, params, options)`) when in doubt.
 */
const _SPAWN_OPTION_KEYS: ReadonlySet<string> = new Set(["key"]);
function _looksLikeSpawnOptions(v: unknown): v is SpawnOptions {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  for (const k of keys) {
    if (!_SPAWN_OPTION_KEYS.has(k)) return false;
  }
  return true;
}

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

  /** Default transition used when this scene is the destination of a push/pop/replace. */
  readonly defaultTransition?: SceneTransition;

  /** Manual pause flag. Set by game code to pause this scene regardless of stack position. */
  paused = false;

  /** Time scale multiplier for this scene. 1.0 = normal, 0.5 = half speed. Default: 1. */
  timeScale = 1;

  private entities = new Set<Entity>();
  private destroyQueue: Entity[] = [];
  private _context!: EngineContext;
  private entityCallbacks!: EntityCallbacks;
  private queryCache: QueryCache | undefined;
  private bus: EventBus<EngineEvents> | undefined;
  private _entityEventHandlers?: Map<
    string,
    Set<(data: never, entity: Entity) => void>
  >;
  private _entityEventObserver?:
    | ((eventName: string, data: unknown, entity: Entity) => void)
    | undefined;
  private _scopedServices?: Map<string, unknown>;
  private _identityIndex?: Map<string, Entity>;

  /** Access the EngineContext. */
  get context(): EngineContext {
    return this._context;
  }

  /** Whether this scene is effectively paused (manual pause or paused by stack). */
  get isPaused(): boolean {
    if (this.paused) return true;
    const sm = this._context?.tryResolve(SceneManagerKey);
    if (!sm) return false;
    const stack = sm.all;
    const idx = stack.indexOf(this);
    if (idx === -1) return false;
    for (let i = idx + 1; i < stack.length; i++) {
      if (stack[i]!.pauseBelow) return true;
    }
    return false;
  }

  /** Whether a scene transition is currently running. */
  get isTransitioning(): boolean {
    const sm = this._context?.tryResolve(SceneManagerKey);
    return sm?.isTransitioning ?? false;
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

  /**
   * Spawn a new entity in this scene.
   *
   * Pass `{ key }` in the trailing options to register a stable per-scene
   * identity key, looked up later via `scene.findByKey`. The key is assigned
   * before `setup()` runs, so `entity.requireKey()` is safe inside it.
   *
   * Runtime routing for the 2-arg class form (`spawn(Class, X)`):
   *   - If the class doesn't declare `setup` → `X` is options.
   *   - Else if `X`'s own keys are exactly SpawnOptions fields (`{ key }`) →
   *     `X` is options. Covers both `setup(params = {})` keyed without
   *     params and `setup()` (no real params) keyed.
   *   - Else → `X` is params (forwarded to `setup`).
   * The 3-arg form is always unambiguous: `spawn(Class, params, options)`.
   *
   * Don't name a top-level setup-params field `key` — the shape check would
   * misroute it. If you must, use the 3-arg form.
   */
  spawn(name?: string, options?: SpawnOptions): Entity;
  /**
   * Spawn from a blueprint. **Note**: blueprint params must not include a
   * top-level `key: string` field — the runtime can't disambiguate it from
   * `SpawnOptions`. If your params do, use the explicit 3-arg form
   * (`spawn(bp, params, { key })`) so options arrives in the trailing slot.
   */
  spawn<P>(blueprint: Blueprint<P>, params: P, options?: SpawnOptions): Entity;
  spawn(blueprint: Blueprint<void>, options?: SpawnOptions): Entity;
  /** Spawn an entity subclass with setup params. */
  spawn<E extends Entity, P>(
    Class: new () => E & { setup(params: P): void },
    params: P,
    options?: SpawnOptions,
  ): E;
  /** Spawn an entity subclass without setup params. */
  spawn<E extends Entity>(Class: new () => E, options?: SpawnOptions): E;
  spawn(
    nameOrBlueprintOrClass?: string | Blueprint<unknown> | (new () => Entity),
    paramsOrOptions?: unknown,
    maybeOptions?: SpawnOptions,
  ): Entity {
    // Class-based spawn: argument is a constructor function for an Entity subclass
    if (typeof nameOrBlueprintOrClass === "function") {
      const Ctor = nameOrBlueprintOrClass;
      const hasSetup =
        typeof (Ctor.prototype as { setup?: unknown }).setup === "function";

      let params: unknown;
      let options: SpawnOptions | undefined;
      if (maybeOptions !== undefined) {
        // 3-arg: explicit. paramsOrOptions = params, maybeOptions = options.
        params = paramsOrOptions;
        options = maybeOptions;
      } else if (paramsOrOptions === undefined) {
        // 1-arg: nothing to route.
      } else if (!hasSetup) {
        // No setup → 2nd arg can only be options.
        options = paramsOrOptions as SpawnOptions;
      } else if (_looksLikeSpawnOptions(paramsOrOptions)) {
        // Setup exists, but the 2nd arg is options-shaped (only `key`).
        // This covers two cases that arity alone gets wrong:
        //   - setup(params = {}) with `spawn(Class, { key })` → options ✓
        //   - setup() with `spawn(Class, { key })` → options ✓
        // For setup-bearing classes whose params type happens to have ONLY
        // a top-level `key` field, the user must use the 3-arg form.
        options = paramsOrOptions;
      } else {
        // Setup exists and 2nd arg has params-shaped content (e.g.
        // `{ position, zoom }`). Forward to setup.
        params = paramsOrOptions;
      }

      const entity = new Ctor();
      entity._setScene(this, this.entityCallbacks);
      // Register key BEFORE adding to entities/emitting created — a duplicate
      // key throw must not leave a half-spawned entity in the scene.
      if (options?.key !== undefined) this._registerKey(entity, options.key);
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

    // Routing for non-class forms:
    //   spawn(name, options?)            → paramsOrOptions = options
    //   spawn(blueprint, params, options?) → paramsOrOptions = params, maybeOptions = options
    //   spawn(blueprint, options?)        (Blueprint<void>) → paramsOrOptions = options
    // For blueprints we can't introspect arity reliably (build is user code);
    // disambiguate via a 3-arg call (always passes options as the third arg)
    // vs 2-arg (where the second slot is options for void blueprints, or params
    // for parameterised ones — which is fine because params for a `Blueprint<void>`
    // doesn't typecheck either way).
    let blueprintParams: unknown;
    let options: SpawnOptions | undefined;
    if (isBlueprint) {
      if (maybeOptions !== undefined) {
        blueprintParams = paramsOrOptions;
        options = maybeOptions;
      } else if (
        paramsOrOptions !== undefined &&
        _looksLikeSpawnOptions(paramsOrOptions)
      ) {
        options = paramsOrOptions;
      } else {
        blueprintParams = paramsOrOptions;
      }
    } else {
      // spawn(name, options?)
      options = paramsOrOptions as SpawnOptions | undefined;
    }

    const entity = new Entity(name);
    entity._setScene(this, this.entityCallbacks);
    if (options?.key !== undefined) this._registerKey(entity, options.key);
    this.entities.add(entity);
    this.bus?.emit("entity:created", { entity });

    if (isBlueprint) {
      (nameOrBlueprintOrClass as Blueprint<unknown>).build(
        entity,
        blueprintParams,
      );
    }

    return entity;
  }

  /**
   * Look up an entity by its stable identity key, scoped to this scene.
   * Returns `undefined` for unknown or already-destroyed entities.
   */
  findByKey<E extends Entity = Entity>(key: string): E | undefined {
    const entity = this._identityIndex?.get(key);
    if (!entity || entity.isDestroyed) return undefined;
    return entity as E;
  }

  /**
   * Internal: register a key on a freshly spawned entity. Throws on
   * duplicate so callers (Scene.spawn) can abort before adding to
   * `this.entities` or emitting `entity:created`.
   * @internal
   */
  _registerKey(entity: Entity, key: string): void {
    this._identityIndex ??= new Map();
    const existing = this._identityIndex.get(key);
    if (existing && !existing.isDestroyed) {
      throw new Error(
        `Scene "${this.name}" already has an entity with key "${key}". ` +
          `Destroy it before spawning a duplicate.`,
      );
    }
    this._identityIndex.set(key, entity);
    entity._setKey(key);
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

  /** Find entities matching a filter. Trait filter narrows the return type. */
  findEntities<T>(filter: EntityFilter & { trait: TraitToken<T> }): (Entity & T)[];
  findEntities(filter?: EntityFilter): Entity[];
  findEntities(filter?: EntityFilter): Entity[] {
    if (!filter) {
      const result: Entity[] = [];
      for (const e of this.entities) {
        if (!e.isDestroyed) result.push(e);
      }
      return result;
    }
    return filterEntities(this.entities, filter);
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

  /**
   * Observe entity-scoped event emissions after they dispatch locally and
   * bubble to the scene. Tooling only; game code should keep using `on()`.
   * @internal
   */
  _observeEntityEvent(eventName: string, data: unknown, entity: Entity): void {
    this._entityEventObserver?.(eventName, data, entity);
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

  /** Return a JSON-serializable snapshot of this scene's custom state. Used by the save system. */
  serialize?(): unknown;

  /** Called after entities are restored during save/load. Rebuild non-serializable state here. */
  afterRestore?(data: unknown, resolve: SnapshotResolver): void;

  // ---- Internal methods ----

  /**
   * Register a scene-scoped service. Called from a plugin's `beforeEnter`
   * hook to make per-scene state (render tree, physics world) resolvable via
   * `Component.use(key)`.
   * @internal
   */
  _registerScoped<T>(key: ServiceKey<T>, value: T): void {
    this._scopedServices ??= new Map();
    this._scopedServices.set(key.id, value);
  }

  /**
   * Install or clear a tooling-only observer for bubbled entity events.
   * @internal
   */
  _setEntityEventObserver(
    observer?: (eventName: string, data: unknown, entity: Entity) => void,
  ): void {
    this._entityEventObserver = observer;
  }

  /**
   * Resolve a scene-scoped service, or `undefined` if none was registered.
   * @internal
   */
  _resolveScoped<T>(key: ServiceKey<T>): T | undefined {
    return this._scopedServices?.get(key.id) as T | undefined;
  }

  /**
   * Clear all scene-scoped services. Called by the SceneManager after
   * `afterExit` hooks run, so plugin cleanup code still sees scoped state.
   * @internal
   */
  _clearScopedServices(): void {
    this._scopedServices?.clear();
  }

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
   * Flush the destroy queue — destroy pending entities.
   * Called by the engine during the endOfFrame phase.
   * @internal
   */
  _flushDestroyQueue(): void {
    for (const entity of this.destroyQueue) {
      entity._performDestroy();
      this.queryCache?.onEntityDestroyed(entity);
      this.entities.delete(entity);
      if (
        entity.key !== undefined &&
        this._identityIndex?.get(entity.key) === entity
      ) {
        // Only evict if the slot still points to *this* entity. A
        // same-frame destroy + respawn with the same key replaces the
        // map entry inside `_registerKey`; we must not delete the
        // replacement here.
        this._identityIndex.delete(entity.key);
      }
      this.bus?.emit("entity:destroyed", { entity });
    }
    this.destroyQueue.length = 0;
  }

  /**
   * Destroy all entities — used during scene exit. Clears the identity
   * index in bulk; per-entity key removal in `_flushDestroyQueue` is the
   * in-game path.
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
    this._identityIndex?.clear();
  }
}
