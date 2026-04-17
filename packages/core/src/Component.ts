import type { EngineContext, ServiceKey } from "./EngineContext.js";
import type { Entity } from "./Entity.js";
import type { EventToken } from "./EventToken.js";
import type { ComponentClass } from "./types.js";
import type { SnapshotResolver } from "./Serializable.js";
import type { Logger } from "./Logger.js";
import { LoggerKey } from "./EngineContext.js";

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
  entity!: import("./Entity.js").Entity;

  /** Whether this component is active. Disabled components are skipped by ComponentUpdateSystem. */
  enabled = true;

  private _serviceCache: Map<string, unknown> | undefined;
  private _cleanups?: Array<() => void>;

  /**
   * Access the entity's scene. Throws if the entity is not in a scene.
   * Prefer this over `this.entity.scene!` in component methods.
   */
  get scene(): import("./Scene.js").Scene {
    const scene = this.entity.scene;
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
    this._serviceCache ??= new Map();
    const cached = this._serviceCache.get(key.id);
    if (cached !== undefined) return cached as T;

    const scene = this.entity.scene;
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
   * readonly camera = this.service(CameraKey);
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

  /** Subscribe to scene-level bubbled events, auto-unsubscribe on removal. */
  protected listenScene<T>(
    token: EventToken<T>,
    handler: (data: T, entity: Entity) => void,
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
   * Called by Entity.remove() and Entity._performDestroy() before onRemove/onDestroy.
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

  /** Called when the component is added to an entity. */
  onAdd?(): void;

  /** Called when the component is removed from an entity. */
  onRemove?(): void;

  /** Called when the component is destroyed (entity destroyed or component removed). */
  onDestroy?(): void;

  /** Called every frame by the built-in ComponentUpdateSystem. */
  update?(dt: number): void;

  /** Called every fixed timestep by the built-in ComponentUpdateSystem. */
  fixedUpdate?(dt: number): void;

  /** Return a JSON-serializable snapshot of this component's state. Used by the save system. */
  serialize?(): unknown;

  /** Called after onAdd() during save/load restoration. Apply state that depends on onAdd() having run. */
  afterRestore?(data: unknown, resolve: SnapshotResolver): void;
}
