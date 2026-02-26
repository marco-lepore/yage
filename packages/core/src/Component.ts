import type { EngineContext, ServiceKey } from "./EngineContext.js";
import type { Entity } from "./Entity.js";
import type { EventToken } from "./EventToken.js";

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
   * Access the EngineContext from the entity's scene.
   * Throws if the entity is not in a scene.
   */
  get context(): EngineContext {
    const scene = this.entity.scene;
    if (!scene) {
      throw new Error(
        "Cannot access context: entity is not attached to a scene.",
      );
    }
    return scene.context;
  }

  /** Resolve a service by key, cached after first lookup. */
  protected use<T>(key: ServiceKey<T>): T {
    this._serviceCache ??= new Map();
    let value = this._serviceCache.get(key.id);
    if (value === undefined) {
      value = this.context.resolve(key);
      this._serviceCache.set(key.id, value);
    }
    return value as T;
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
    const scene = this.entity.scene;
    if (!scene) {
      throw new Error(
        "Cannot listenScene: entity is not attached to a scene.",
      );
    }
    const unsub = scene.on(token, handler);
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
}
