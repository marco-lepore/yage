import type { EngineContext, ServiceKey } from "./EngineContext.js";
import type { Entity } from "./Entity.js";
import type { EventToken } from "./EventToken.js";
import type { Logger } from "./Logger.js";
import type { Scene } from "./Scene.js";
import type { SnapshotResolver } from "./Serializable.js";
import type { ComponentClass } from "./types.js";
import { LoggerKey, ErrorBoundaryKey } from "./EngineContext.js";

/**
 * Base class for all components.
 *
 * Components are the primary authoring model. Game developers write behavior
 * in components using optional `update(dt)` and `fixedUpdate(dt)` methods.
 * The built-in ComponentUpdateSystem calls these methods automatically.
 */
export abstract class Component {
  /**
   * Back-reference to the owning entity. Set by the engine when the component
   * is added to an entity. Do not set manually.
   */
  entity!: Entity;

  private _enabled = true;
  /** Whether `onEnable` has fired without a matching `onDisable` yet. */
  private _effectivelyEnabled = false;
  private _updatePriority?: number;
  private _serviceCache: Map<string, unknown> | undefined;
  private _cleanups?: Array<() => void>;
  private _tornDown = false;

  /**
   * Whether this component runs. Disabled components are skipped by
   * ComponentUpdateSystem.
   *
   * Writing this fires {@link onEnable} / {@link onDisable} when the
   * *effective* state changes — `enabled && entity.isActive`. A component
   * disabled here stays disabled through a `setActive(false)` /
   * `setActive(true)` cycle on its entity.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled === value) return;
    this._enabled = value;
    this._refreshEnabled();
  }

  /**
   * Whether the component is actually running: `enabled`, on an active
   * entity, and past `onAdd`. This is the state {@link onEnable} and
   * {@link onDisable} track — read it when a method has to behave one way
   * live and another way dormant.
   */
  get effectiveEnabled(): boolean {
    return this._effectivelyEnabled;
  }

  /**
   * Where this component runs among its siblings. `ComponentUpdateSystem`
   * calls `update` / `fixedUpdate` on an entity's components in ascending
   * priority; equal priorities run in add order. Undeclared = 0, so a
   * negative value runs before siblings that keep the default and a positive
   * value runs after them. Writable at any time, before or after `add()`.
   * Defaults to the class's `static updatePriority`.
   *
   * ```ts
   * class Player extends Entity {
   *   setup() {
   *     this.add(new Mover());
   *     this.add(new Brain()).updatePriority = -1; // decides before Mover moves
   *   }
   * }
   * ```
   */
  get updatePriority(): number {
    return (
      this._updatePriority ??
      (this.constructor as typeof Component).updatePriority ??
      0
    );
  }

  set updatePriority(value: number) {
    this._updatePriority = value;
    (this.entity as Entity | undefined)?._invalidateUpdateOrder(this);
  }

  /**
   * Access the entity's scene. Throws if the entity is not in a scene.
   * Prefer this over threading through `this.entity.scene` in component
   * code.
   */
  get scene(): Scene {
    const scene = this.entity.tryScene;
    if (!scene) {
      throw new Error(
        "Cannot access scene: entity is not attached to a scene.",
      );
    }
    return scene;
  }

  /**
   * Access the EngineContext from the entity's scene.
   * Throws if the entity is not in a scene.
   */
  get context(): EngineContext {
    return this.scene.context;
  }

  /**
   * Resolve a service by key, cached after first lookup. Scene-scoped values
   * (registered via `scene._registerScoped`) take precedence over engine
   * scope. A key declared with `scope: "scene"` that falls back to engine
   * scope emits a one-shot dev warning — almost always signals a missed
   * `beforeEnter` hook.
   */
  protected use<T>(key: ServiceKey<T>): T {
    // `this.entity` is set by Entity.add(...) AFTER the component instance is
    // constructed. Calling `use()` in a field initializer (which runs during
    // construction) hits this with `this.entity === undefined` and crashes
    // deep inside `tryScene` access. Fail with a named, actionable error
    // pointing at `this.service(Key)` (the lazy alternative) instead.
    if (!this.entity) {
      throw new Error(
        `Component.use(${key.id}) called before the component is bound to an entity. ` +
          `Use this.service(Key) for lazy resolution at field-declaration time, ` +
          `or move the .use() call into onAdd()/update().`,
      );
    }
    this._serviceCache ??= new Map();
    const cached = this._serviceCache.get(key.id);
    if (cached !== undefined) return cached as T;

    const scene = this.entity.tryScene;
    const scoped = scene?._resolveScoped(key);
    if (scoped !== undefined) {
      this._serviceCache.set(key.id, scoped);
      return scoped;
    }

    const value = this.context.resolve(key);
    if (key.scope === "scene") {
      // Don't cache: a later scoped registration should take precedence,
      // and the warning should keep firing until the plugin wiring is
      // fixed — caching would silence it after one hit.
      this._warnScopedFallback(key);
      return value;
    }
    this._serviceCache.set(key.id, value);
    return value;
  }

  private _warnScopedFallback<T>(key: ServiceKey<T>): void {
    const logger = this.context.tryResolve(LoggerKey) as Logger | undefined;
    logger?.warn(
      "core",
      `Scoped key "${key.id}" fell back to engine scope — did a plugin forget to register a beforeEnter hook?`,
      { component: this.constructor.name },
    );
  }

  /**
   * Lazy proxy-based service resolution. Can be used at field-declaration time:
   * ```ts
   * readonly input = this.service(InputManagerKey);
   * ```
   * The actual resolution is deferred until first property access.
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
   * Lazy proxy-based sibling component resolution. Can be used at field-declaration time:
   * ```ts
   * readonly anim = this.sibling(AnimatedSpriteComponent);
   * ```
   * The actual resolution is deferred until first property access.
   */
  protected sibling<C extends Component>(cls: ComponentClass<C>): C {
    let resolved: C | undefined;
    return new Proxy({} as object, {
      get: (_target, prop) => {
        resolved ??= this.entity.get(cls);
        const value = (resolved as Record<string | symbol, unknown>)[prop];
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(resolved)
          : value;
      },
      set: (_target, prop, value) => {
        resolved ??= this.entity.get(cls);
        (resolved as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }) as C;
  }

  /** Subscribe to events on any entity, auto-unsubscribe on removal. */
  protected listen<T>(
    entity: Entity,
    token: EventToken<T>,
    handler: (data: T) => void,
  ): void {
    const unsub = entity.on(token, handler);
    this.addCleanup(unsub);
  }

  /**
   * Subscribe to scene-level events, auto-unsubscribe on removal. Handlers
   * fire for bubbled entity events (entity = source) and `scene.emit`
   * events (entity = undefined).
   */
  protected listenScene<T>(
    token: EventToken<T>,
    handler: (data: T, entity?: Entity) => void,
  ): void {
    const unsub = this.scene.on(token, handler);
    this.addCleanup(unsub);
  }

  /** Register a cleanup function to run when this component is removed or destroyed. */
  protected addCleanup(fn: () => void): void {
    this._cleanups ??= [];
    this._cleanups.push(fn);
  }

  /**
   * Run and clear all registered cleanups.
   * Called by Entity.remove() and Entity._performDestroy() before onDestroy.
   * @internal
   */
  _runCleanups(): void {
    if (this._cleanups) {
      for (const fn of this._cleanups) {
        fn();
      }
      this._cleanups.length = 0;
    }
  }

  /**
   * End this component's life on its own — the same as
   * `entity.remove(SomeClass)`, without having to name its own class from
   * inside itself, which breaks under subclassing.
   */
  destroy(): void {
    (this.entity as Entity | undefined)?.remove(
      this.constructor as ComponentClass,
    );
  }

  /**
   * Internal: true once this component has been removed or its entity
   * destroyed. Components are terminal — `Entity.add` uses this to reject
   * re-attaching an instance whose cleanups and `onDestroy` already ran.
   * @internal
   */
  _isTornDown(): boolean {
    return this._tornDown;
  }

  /**
   * Internal: mark this component torn down. Called by `Entity.remove()` and
   * `Entity._performDestroy()` after `onDestroy` runs.
   * @internal
   */
  _markTornDown(): void {
    this._tornDown = true;
  }

  /**
   * Recompute effective enabled-ness from `enabled` and the entity's
   * activeness, firing the hook on a flip.
   * @internal
   */
  _refreshEnabled(): void {
    const entity = this.entity as Entity | undefined;
    this._applyEnabled(this._enabled && entity?.isActive === true);
  }

  /**
   * Force an effective-enabled transition, firing the hook on a flip. Used by
   * `Entity` for teardown, where `enabled` and the entity's activeness both
   * still read `true`.
   * @internal
   */
  _applyEnabled(effective: boolean): void {
    if (this._effectivelyEnabled === effective) return;
    this._effectivelyEnabled = effective;
    const hook = effective ? this.onEnable : this.onDisable;
    if (!hook) return;
    const boundary = (
      this.entity as Entity | undefined
    )?.tryScene?.context.tryResolve(ErrorBoundaryKey);
    if (boundary) {
      boundary.wrapComponent(this, () => hook.call(this));
    } else {
      hook.call(this);
    }
  }

  /**
   * Called when the component is added to an entity. Validate dependencies
   * here — a service, a sibling component, a render layer — and throw when
   * one is missing. The throw is attributed to this component, recorded in
   * `Inspector.getErrors().callbackErrors`, and rethrown, so it reaches the
   * caller of `entity.add()` unchanged.
   */
  onAdd?(): void;

  /**
   * Called when the component becomes effectively enabled — `enabled` is
   * `true` and the entity is active. Fires right after `onAdd()` for a
   * component added to an active entity, and again on every later flip.
   * Bring live resources back online here (unpause a sound, show a display
   * object, re-enable a physics body). Game-state reset does not belong here:
   * the hook sees whatever state the component held while dormant.
   */
  onEnable?(): void;

  /**
   * Called when the component stops being effectively enabled — `enabled`
   * went `false`, the entity (or an ancestor) was deactivated, or the
   * component is being removed or destroyed. Put live resources to sleep
   * here; the component is reused afterwards, so do not free anything
   * `onEnable` cannot rebuild.
   */
  onDisable?(): void;

  /** Called when the component is destroyed (entity destroyed or component removed). */
  onDestroy?(): void;

  /**
   * Called every frame by the built-in ComponentUpdateSystem.
   * @param dt Frame delta in seconds, scaled by scene and entity `timeScale`.
   */
  update?(dt: number): void;

  /**
   * Called every fixed timestep by the built-in ComponentUpdateSystem.
   * @param dt Fixed timestep in seconds, scaled by scene and entity `timeScale`.
   */
  fixedUpdate?(dt: number): void;

  /**
   * Snapshot restore order. On load, an entity's components are re-added in
   * ascending priority, so a component whose `onAdd()` reads a sibling can
   * rely on lower-priority siblings being present and initialized.
   * Undeclared = 100. Engine components reserve 0-99; game and addon
   * components declare a value only when a sibling `onAdd()` dependency
   * requires it. Equal priorities restore in save-time add order.
   * Subclasses inherit their base class's priority unless they declare
   * their own.
   */
  declare static restorePriority?: number;

  /**
   * Class-level default for {@link updatePriority}: every instance runs at
   * this priority unless its own `updatePriority` is written. Undeclared = 0.
   * Subclasses inherit their base class's value unless they declare their
   * own. Declare it on a component whose behavior depends on running after
   * (or before) a sibling, so the entity that adds it does not have to
   * control the add order.
   *
   * ```ts
   * class BoundsClamp extends Component {
   *   static updatePriority = 10; // after the follow that moves the camera
   * }
   * ```
   */
  declare static updatePriority?: number;

  /** Return a JSON-serializable snapshot of this component's state. Used by the save system. */
  serialize?(): unknown;

  /** Called after onAdd() during save/load restoration. Apply state that depends on onAdd() having run. */
  afterRestore?(data: unknown, resolve: SnapshotResolver): void;
}
