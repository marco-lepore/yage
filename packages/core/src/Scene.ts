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
import type { Logger } from "./Logger.js";
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
  LoggerKey,
  ErrorBoundaryKey,
} from "./EngineContext.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import { devWarn } from "./internal/dev.js";

/**
 * Options accepted by the trailing argument of `Scene.spawn` and
 * `Entity.spawnChild`.
 */
export interface SpawnOptions {
  /**
   * Stable per-scene identity key. Looked up via `Scene.findByKey` and used
   * as a stable id in reactive stores (e.g. a `createSet<string>()` persisted under `"world.opened"`).
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
 * The params object an entity's `setup(params)` accepts, inferred from the
 * class. Resolves to `never` for entities that declare no `setup` method.
 */
export type SetupParams<E> = E extends { setup(params: infer P): void }
  ? P
  : never;

/**
 * The parameter tuple of an entity's declared `setup` method. Resolves to
 * `never` when the entity only inherits the base optional `setup?` — the base
 * signature is optional, so a class that doesn't override it fails the
 * required-method match.
 */
type SetupParamTuple<E> = E extends { setup(...args: infer A): void }
  ? A
  : never;

/**
 * Trailing arguments of the class form of `spawn` / `spawnChild`, derived from
 * the entity's `setup()` signature. An omitted required field is reported as a
 * missing property on the params type.
 *
 * The params slot follows the `setup` PARAMETER, not the param object's fields:
 *   - no declared `setup` → only the trailing options slot.
 *   - `setup(): void` with zero parameters → no params slot; behaves like a
 *     class with no declared `setup`, so `spawn(Class, options?)`.
 *   - `setup(params?)` or a defaulted parameter (a zero-argument call is valid,
 *     so `[]` is assignable to the parameter tuple) → params slot optional.
 *   - `setup(params)` with a required parameter → params slot required, even
 *     when the param object's own fields are all optional. `setup(undefined)`
 *     at runtime would break a body that reads `params`, so the type demands
 *     the argument.
 *
 * The zero-parameter branch (`SetupParamTuple<E> extends readonly []`) must
 * precede the optional-parameter branch: an exactly-empty tuple `[]` is
 * assignable to `readonly []`, while an optional-first-parameter tuple `[X?]`
 * is not, so the check catches only a genuine zero-arg `setup` and leaves
 * `setup(params?)` to the branch below.
 *
 * The params slot is typed as `SetupParams<E>` alone (not
 * `SetupParams<E> | SpawnOptions`), so a `SpawnOptions`-shaped object is not
 * silently accepted where params belong. The one residual: if the param type
 * itself declares an optional `key`, a `{ key }` literal satisfies the slot and
 * the runtime routes it to options — the "don't name a top-level setup field
 * `key`" footgun documented on `SpawnOptions.key`. Use the explicit 3-arg form.
 */
export type ClassSpawnArgs<E> = [SetupParamTuple<E>] extends [never]
  ? [options?: SpawnOptions]
  : SetupParamTuple<E> extends readonly []
    ? [options?: SpawnOptions]
    : [] extends SetupParamTuple<E>
      ? [params?: SetupParams<E>, options?: SpawnOptions]
      : [params: SetupParams<E>, options?: SpawnOptions];

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

  /**
   * Whether scenes below this one should still render. Default: `false`.
   *
   * When `false` (the default), the renderer hides every below-stack scene
   * tree — both world-space layers AND screen-space layers (HUD, UI panels,
   * dialogs). Set `true` for pause menus, dialog overlays, or any scene
   * that should be drawn on top of a still-visible game world.
   *
   * The chain composes: a below scene stays visible only while every scene
   * above it has `transparentBelow = true`. While a scene transition is
   * running, both the outgoing and incoming scenes render regardless of
   * this flag so transitions like crossFade keep working; the chain is
   * reapplied when the transition ends.
   */
  readonly transparentBelow: boolean = false;

  /** Asset handles to load before onEnter(). Override in subclasses. */
  readonly preload?: readonly AssetHandle<unknown>[];

  /** Default transition used when this scene is the destination of a push/pop/replace. */
  readonly defaultTransition?: SceneTransition;

  /**
   * Manual pause flag. Set by game code to pause this scene regardless of
   * stack position. Assigning it fires `onPause`/`onResume` when the
   * effective pause state (`isPaused`) flips — writes that don't change the
   * flag, or that are masked by a stack pause, fire nothing. Writes before
   * the scene is pushed fire nothing either; the push itself fires `onPause`
   * for a scene entering paused.
   *
   * To start a scene paused, set `paused = true` before pushing it — the push
   * fires `onPause` once. Do NOT write `paused` from inside a lifecycle hook
   * (`onEnter`/`onExit`/`onPause`/`onResume`): that write races the stack
   * transition's own pause diff, so `onPause`/`onResume` can fire twice or
   * unpaired. A dev-mode warning flags this case.
   */
  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    if (value === this._paused) return;
    // Diff the effective state across the write, mirroring the stack-
    // transition diff in SceneManager: the hooks track isPaused, not the
    // raw flag.
    const wasEffective = this.isPaused;
    this._paused = value;
    if (!this._context) return;
    const isEffective = this.isPaused;
    if (isEffective === wasEffective) return;
    // A write from inside a lifecycle hook double-counts: the transition
    // snapshots effective pause before the mutation and re-fires the hook
    // after, so this synchronous fire duplicates or unpairs it.
    if (this._context.tryResolve(SceneManagerKey)?._isMutating) {
      devWarn(
        "Scene.paused was set from inside a lifecycle hook; onPause/onResume " +
          "may fire twice or unpaired. To start a scene paused, set " +
          "`paused = true` before pushing it.",
      );
    }
    const boundary = this._context.tryResolve(ErrorBoundaryKey);
    if (isEffective) {
      this._invokeLifecycleHook(boundary, "onPause", () => this.onPause?.());
    } else {
      this._invokeLifecycleHook(boundary, "onResume", () => this.onResume?.());
    }
  }

  /**
   * Run a lifecycle hook (`onPause`/`onResume` triggered from this setter,
   * separate from the push/pop/replace-driven calls in `SceneManager`)
   * through the error boundary when one is available. Reports and rethrows
   * so a throwing hook still surfaces exactly as it does today.
   */
  private _invokeLifecycleHook(
    boundary: ErrorBoundary | undefined,
    phase: string,
    fn: () => void,
  ): void {
    if (boundary) {
      boundary.wrapLifecycleHook(fn, { kind: `Scene ${phase} hook`, scene: this.name });
    } else {
      fn();
    }
  }

  private _paused = false;

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

  /**
   * Set by `Entity.spawnChild` while the parent is dormant. A spawn runs
   * `setup()` before the parent link exists, so without this the child would
   * be briefly active and fire enable hooks it is about to undo.
   * @internal
   */
  _spawnInert = false;

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
   * Resolve a service by key. Scene-scoped values (registered via
   * `registerScoped` — e.g. the renderer's per-scene render tree) take
   * precedence over engine scope, so the obvious call works in the obvious
   * place:
   * ```ts
   * onEnter() {
   *   const tree = this.use(SceneRenderTreeKey); // resolvable from onEnter on
   *   tree.fx.addEffect(crt());
   * }
   * ```
   * Scene-scoped values are registered by plugin `beforeEnter` hooks, which
   * run before `onEnter`, so they're available throughout the scene's
   * lifecycle. Throws if the key resolves nowhere. For lazy resolution at
   * field-declaration time, use `service()`.
   */
  protected use<T>(key: ServiceKey<T>): T {
    const scoped = this._resolveScoped(key);
    if (scoped !== undefined) return scoped;

    if (key.scope === "scene") {
      const engineValue = this._context.tryResolve(key);
      if (engineValue !== undefined) {
        // A scene-scoped key that only resolves at engine scope almost
        // always means a plugin forgot to register it in a beforeEnter hook.
        this._warnScopedFallback(key);
        return engineValue;
      }
      throw new Error(
        `Scene-scoped service "${key.id}" is not registered for scene "${this.name}". ` +
          `Scene-scoped services are provided by a plugin's beforeEnter hook ` +
          `(e.g. RendererPlugin registers SceneRenderTreeKey). Resolve it from ` +
          `onEnter() or later, and make sure the providing plugin is installed.`,
      );
    }

    return this._context.resolve(key);
  }

  private _warnScopedFallback<T>(key: ServiceKey<T>): void {
    const logger = this._context.tryResolve(LoggerKey) as Logger | undefined;
    logger?.warn(
      "core",
      `Scoped key "${key.id}" fell back to engine scope — did a plugin forget to register a beforeEnter hook?`,
      { scene: this.name },
    );
  }

  /**
   * Lazy proxy-based service resolution. Can be used at field-declaration time:
   * ```ts
   * readonly layers = this.service(RenderLayerManagerKey);
   * ```
   * The actual resolution is deferred until first property access and is
   * scope-aware (see `use()`). For scene-scoped keys, prefer resolving inside
   * `onEnter()` via `use()` rather than a field initializer — the proxy
   * caches the first resolved value, which would go stale if the scene is
   * exited and re-entered (the scoped value is recreated each enter).
   */
  protected service<T extends object>(key: ServiceKey<T>): T {
    let resolved: T | undefined;
    return new Proxy({} as object, {
      get: (_target, prop) => {
        resolved ??= this.use(key);
        const value = (resolved as Record<string | symbol, unknown>)[prop];
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(resolved)
          : value;
      },
      set: (_target, prop, value) => {
        resolved ??= this.use(key);
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
   * For the class form, the params type is inferred from the entity's
   * `setup(params)` signature. Omitting a required field reports that field as
   * missing on the params object, naming the field that's actually absent.
   *
   * Runtime routing for the 2-arg class form (`spawn(Class, X)`):
   *   - If the class doesn't declare `setup` → `X` is options.
   *   - Else if `X`'s own keys are exactly SpawnOptions fields (`{ key }`) →
   *     `X` is options. Covers both `setup(params = {})` keyed without
   *     params and `setup()` (no real params) keyed.
   *   - Else → `X` is params (forwarded to `setup`).
   * The 3-arg form is always unambiguous: `spawn(Class, params, options)`.
   * If `setup()` throws, the entity is destroyed and removed before the
   * error is rethrown.
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
  /** Spawn an entity subclass; trailing args follow its `setup()` signature. */
  spawn<E extends Entity>(Class: new () => E, ...rest: ClassSpawnArgs<E>): E;
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
      if (this._spawnInert) entity._setActiveSuppressed(true);
      entity._setScene(this, this.entityCallbacks);
      // Register key BEFORE adding to entities/emitting created — a duplicate
      // key throw must not leave a half-spawned entity in the scene.
      if (options?.key !== undefined) this._registerKey(entity, options.key);
      this.entities.add(entity);
      this.bus?.emit("entity:created", { entity });
      try {
        entity.setup?.(params);
      } catch (error) {
        this._discardFailedSpawn(entity);
        throw error;
      }
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
    if (this._spawnInert) entity._setActiveSuppressed(true);
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
    entity._setKey(key);
    this._identityIndex.set(key, entity);
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

  /**
   * Every entity in the scene, dormant ones included — this is the set save
   * and teardown walk. The lookups below and the query cache return active
   * entities only.
   */
  getEntities(): ReadonlySet<Entity> {
    return this.entities;
  }

  /** Find an active entity by name (first match). */
  findEntity(name: string): Entity | undefined {
    for (const e of this.entities) {
      if (e.name === name && !e.isDestroyed && e.isActive) return e;
    }
    return undefined;
  }

  /** Find active entities by tag. */
  findEntitiesByTag(tag: string): Entity[] {
    const result: Entity[] = [];
    for (const e of this.entities) {
      if (e.tags.has(tag) && !e.isDestroyed && e.isActive) result.push(e);
    }
    return result;
  }

  /** Find active entities matching a filter. Trait filter narrows the return type. */
  findEntities<T>(filter: EntityFilter & { trait: TraitToken<T> }): (Entity & T)[];
  findEntities(filter?: EntityFilter): Entity[];
  findEntities(filter?: EntityFilter): Entity[] {
    if (!filter) {
      const result: Entity[] = [];
      for (const e of this.entities) {
        if (!e.isDestroyed && e.isActive) result.push(e);
      }
      return result;
    }
    return filterEntities(this.entities, filter);
  }

  /**
   * Subscribe to scene-level events. Handlers fire for both:
   *   - bubbled events from any entity (via `entity.emit`) — `entity` is the source
   *   - scene-emitted events (via `scene.emit`) — `entity` is `undefined`
   */
  on<T>(
    token: EventToken<T>,
    handler: (data: T, entity?: Entity) => void,
  ): () => void {
    this._entityEventHandlers ??= new Map();
    let handlers = this._entityEventHandlers.get(token.name);
    if (!handlers) {
      handlers = new Set();
      this._entityEventHandlers.set(token.name, handlers);
    }
    handlers.add(handler as (data: never, entity?: Entity) => void);

    return () => {
      handlers.delete(handler as (data: never, entity?: Entity) => void);
    };
  }

  /**
   * Emit a typed event at the scene level. Scene-level `on` handlers fire
   * with `entity = undefined` to indicate there's no emitting entity.
   * Symmetric to `Entity.emit` but for scene-scoped signalling.
   */
  emit(token: EventToken<void>): void;
  emit<T>(token: EventToken<T>, data: T): void;
  emit<T>(token: EventToken<T>, data?: T): void {
    const handlers = this._entityEventHandlers?.get(token.name);
    if (handlers && handlers.size > 0) {
      const boundary = this._context?.tryResolve(ErrorBoundaryKey);
      for (const handler of [...handlers]) {
        const call = handler as (data: unknown, entity?: Entity) => void;
        if (boundary) {
          boundary.wrapCallback(() => call(data, undefined), {
            kind: "Scene event handler",
            scene: this.name,
            event: token.name,
          });
        } else {
          call(data, undefined);
        }
      }
    }
  }

  /**
   * Called by Entity.emit() for bubbling entity events to the scene.
   * @internal
   */
  _onEntityEvent(eventName: string, data: unknown, entity: Entity): void {
    const handlers = this._entityEventHandlers?.get(eventName);
    if (handlers && handlers.size > 0) {
      const boundary = this._context?.tryResolve(ErrorBoundaryKey);
      for (const handler of [...handlers]) {
        const call = handler as (data: unknown, entity?: Entity) => void;
        if (boundary) {
          boundary.wrapCallback(() => call(data, entity), {
            kind: "Scene event handler",
            scene: this.name,
            entity: entity.name,
            event: eventName,
          });
        } else {
          call(data, entity);
        }
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

  /**
   * Called when the scene becomes effectively paused (`isPaused` flips to
   * true), whatever the source: a `pauseBelow` scene pushed on top, a manual
   * `paused = true`, the manager's blur auto-pause, or a snapshot restoring
   * the scene paused.
   */
  onPause?(): void;

  /**
   * Called when the scene stops being effectively paused (`isPaused` flips
   * to false): the scene above is popped, `paused` is cleared, or focus
   * returns after a blur auto-pause.
   */
  onResume?(): void;

  /** Return a JSON-serializable snapshot of this scene's custom state. Used by the save system. */
  serialize?(): unknown;

  /** Called after entities are restored during save/load. Rebuild non-serializable state here. */
  afterRestore?(data: unknown, resolve: SnapshotResolver): void;

  // ---- Internal methods ----

  /**
   * Register a scene-scoped service. Plugins call this from their
   * `beforeEnter` hook to expose per-scene state (render tree, physics
   * world, …) resolvable via `Component.use(key)`. Game code can also use
   * it to attach scene-local services without needing a plugin.
   *
   * Auto-cleared on scene exit — every key registered here is unregistered
   * after `onExit` runs (and after plugin `afterExit` hooks see them).
   */
  registerScoped<T>(key: ServiceKey<T>, value: T): void {
    this._scopedServices ??= new Map();
    this._scopedServices.set(key.id, value);
  }

  /**
   * Internal alias for `registerScoped` kept so existing plugin/test code
   * doesn't churn. Prefer `registerScoped` in new code.
   * @internal
   */
  _registerScoped<T>(key: ServiceKey<T>, value: T): void {
    this.registerScoped(key, value);
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
   * Resolve a scene-scoped service registered via `registerScoped`, or
   * `undefined` if none is registered for this scene. Unlike `use()`, never
   * falls back to engine scope and never throws — the read for systems that
   * iterate scenes (e.g. physics and particles resolving `SceneTimeKey`).
   */
  tryResolveScoped<T>(key: ServiceKey<T>): T | undefined {
    return this._scopedServices?.get(key.id) as T | undefined;
  }

  /**
   * Internal alias for `tryResolveScoped`. Prefer `tryResolveScoped` in
   * new code.
   * @internal
   */
  _resolveScoped<T>(key: ServiceKey<T>): T | undefined {
    return this.tryResolveScoped(key);
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
      onEntityActivated: (entity) => {
        this.queryCache?.onEntityActivated(entity);
      },
      onEntityDeactivated: (entity) => {
        this.queryCache?.onEntityDeactivated(entity);
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
      this._finalizeEntityDestroy(entity);
    }
    this.destroyQueue.length = 0;
  }

  /** Remove a class-spawned entity and its descendants when setup fails. */
  private _discardFailedSpawn(entity: Entity): void {
    const subtree: Entity[] = [];
    const collectChildrenFirst = (member: Entity): void => {
      for (const child of member.children.values()) {
        collectChildrenFirst(child);
      }
      subtree.push(member);
    };
    collectChildrenFirst(entity);

    entity.destroy();
    const discarded = new Set(subtree);
    this.destroyQueue = this.destroyQueue.filter(
      (pending) => !discarded.has(pending),
    );
    for (const member of subtree) {
      this._finalizeEntityDestroy(member);
    }
  }

  private _finalizeEntityDestroy(entity: Entity): void {
    entity._performDestroy();
    this.queryCache?.onEntityDestroyed(entity);
    this.entities.delete(entity);
    if (
      entity.key !== undefined &&
      this._identityIndex?.get(entity.key) === entity
    ) {
      // Only evict if the slot still points to this entity. A same-frame
      // destroy + respawn can replace the map entry before destruction flushes.
      this._identityIndex.delete(entity.key);
    }
    this.bus?.emit("entity:destroyed", { entity });
  }

  /**
   * Destroy all entities — used during scene exit. Applies the same destroy
   * contract as `_flushDestroyQueue`: entities are marked destroyed, torn
   * down, detached from the scene, and `entity:destroyed` is emitted once
   * per entity (including entities queued but not yet flushed). Clears the
   * identity index in bulk; per-entity key removal in `_flushDestroyQueue`
   * is the in-game path.
   * @internal
   */
  _destroyAllEntities(): void {
    // Mark everything first, so a component's onDestroy never observes a
    // half-alive sibling: by the time any teardown runs, every entity in
    // the scene already reads isDestroyed === true.
    for (const entity of this.entities) {
      entity._markDestroyed();
    }
    for (const entity of this.entities) {
      entity._performDestroy();
      this.queryCache?.onEntityDestroyed(entity);
      this.bus?.emit("entity:destroyed", { entity });
    }
    this.entities.clear();
    this.destroyQueue.length = 0;
    this._entityEventHandlers?.clear();
    this._identityIndex?.clear();
  }
}
