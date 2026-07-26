import type { Component } from "./Component.js";
import type { ComponentClass } from "./types.js";
import type { EventToken } from "./EventToken.js";
import type { Blueprint } from "./Blueprint.js";
import type { SnapshotResolver } from "./Serializable.js";
import type { Scene, SpawnOptions, ClassSpawnArgs } from "./Scene.js";
import { TRAITS_KEY, entityClassHasTrait, type TraitToken } from "./Trait.js";
import { Transform } from "./Transform.js";
import { ErrorBoundaryKey } from "./EngineContext.js";

/**
 * The pool side of member ownership, kept structural so `Entity` does not
 * depend on `EntityPool`.
 */
interface EntityPoolOwner {
  _releaseMember(member: Entity): void;
}

/** Auto-incrementing entity ID counter. */
let nextEntityId = 1;

/** Shared empty map returned by `children` when no children exist. */
const EMPTY_CHILDREN: ReadonlyMap<string, Entity> = new Map();

/** Reset the entity ID counter. Exposed for testing only. */
export function _resetEntityIdCounter(): void {
  nextEntityId = 1;
}

/**
 * Callback interface for notifying external systems (QueryCache, EventBus)
 * about entity component changes. Injected by Scene.
 */
export interface EntityCallbacks {
  onComponentAdded(entity: Entity, componentClass: ComponentClass): void;
  onComponentRemoved(entity: Entity, componentClass: ComponentClass): void;
  onEntityActivated(entity: Entity): void;
  onEntityDeactivated(entity: Entity): void;
}

/**
 * An entity is a named container of components with O(1) lookups by type.
 */
export class Entity {
  static [TRAITS_KEY]: Set<symbol> = new Set();
  /** Unique auto-incrementing ID. */
  readonly id: number;
  /** Display name for debugging. */
  readonly name: string;
  /** Tags for group queries. */
  readonly tags: Set<string>;
  /**
   * Stable identity key, scene-scoped. Set at spawn-time when
   * `options.key` is passed to `scene.spawn` / `entity.spawnChild`;
   * `undefined` otherwise. Used with `scene.findByKey` and as a stable
   * id in reactive stores (e.g. a `createSet<string>()` persisted under `"world.opened"`).
   */
  readonly key?: string;

  /**
   * Per-entity time-scale multiplier. Mirrors {@link Scene.timeScale} but
   * scoped to this single entity: the engine composes the delta time passed
   * to this entity's components (and its `ProcessComponent`, particle
   * emitters) as `dt * scene.timeScale * entity.timeScale`. `1` = normal
   * speed, `0.5` = half speed, `0` = frozen, `2` = double speed.
   *
   * Physics is deliberately NOT affected: `PhysicsSystem` steps a single
   * shared Rapier world per scene under `scene.timeScale` only, so a
   * rigid-body entity's simulation cannot be individually slowed or sped up
   * via this field. Use a kinematic body or scale velocities manually if you
   * need per-body time control.
   */
  timeScale = 1;

  private components = new Map<ComponentClass, Component>();
  private _destroyed = false;
  private _pooled = false;
  private _pool: EntityPoolOwner | null = null;
  private _activeSelf = true;
  /** Cached `activeSelf && every ancestor's activeSelf`, kept current by `_applyActive`. */
  private _activeInHierarchy = true;
  private _scene: Scene | null = null;
  private callbacks: EntityCallbacks | null = null;
  private _eventHandlers?: Map<string, Set<(data: never) => void>>;
  private _parent: Entity | null = null;
  private _children: Map<string, Entity> | null = null;

  constructor(name?: string, tags?: Iterable<string>) {
    this.id = nextEntityId++;
    this.name = name ?? new.target.name ?? "Entity";
    this.tags = new Set(tags);
  }

  /**
   * The scene this entity belongs to. Throws if the entity is not attached
   * to a scene — which in practice only happens before `scene.spawn` /
   * `addChild` wires it up, or after the entity is destroyed (end-of-frame
   * flush after `destroy()`, or scene teardown on exit). Inside lifecycle
   * methods (`setup`, component `onAdd`, `update`, and component
   * `onDestroy` during destruction) this is always safe to access.
   *
   * For the rare case where you genuinely need to inspect whether an
   * entity has a scene (e.g. defensive code in systems iterating a query
   * result), use `tryScene` instead.
   */
  get scene(): Scene {
    if (!this._scene) {
      throw new Error(
        `Entity "${this.name}" is not attached to a scene. Use \`tryScene\` if you need to check.`,
      );
    }
    return this._scene;
  }

  /** The scene this entity belongs to, or `null` if detached. */
  get tryScene(): Scene | null {
    return this._scene;
  }

  /**
   * True once the entity is dead — after `destroy()` is called, or once its
   * scene starts tearing it down on scene exit.
   */
  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /**
   * True while an {@link EntityPool} owns this entity. Pool members are left
   * out of save snapshots: a pool restores empty and refills, so whatever was
   * in flight when the game was saved is gone on load.
   */
  get isPooled(): boolean {
    return this._pooled;
  }

  /**
   * Internal: mark the entity as a pool member. Called by `EntityPool` when
   * it constructs one.
   * @internal
   */
  _markPooled(owner: EntityPoolOwner): void {
    this._pooled = true;
    this._pool = owner;
  }

  /**
   * This entity's own activeness bit — what `setActive` last wrote. An entity
   * whose `activeSelf` is `true` can still be dormant, if an ancestor is not.
   * Use {@link isActive} for the state the engine acts on.
   */
  get activeSelf(): boolean {
    return this._activeSelf;
  }

  /**
   * Whether the entity is active: its own `activeSelf` and every ancestor's.
   * A dormant entity keeps all of its components and its place in
   * `scene.getEntities()`, but drops out of queries, `findEntity`,
   * `findEntitiesByTag` and `findEntities`, and its components stop updating.
   */
  get isActive(): boolean {
    return this._activeInHierarchy;
  }

  /**
   * Turn the entity on or off without destroying it. Descendants follow: a
   * child of a dormant entity is dormant whatever its own `activeSelf` says.
   *
   * Components whose effective enabled-ness flips get `onDisable` /
   * `onEnable`. Per-component `enabled` flags are left alone, so a component
   * you disabled by hand stays disabled after the entity comes back.
   *
   * ```ts
   * bullet.setActive(false);                    // hidden, updates skipped
   * bullet.get(Transform).setPosition(x, y);
   * bullet.setActive(true);                     // back in play, no respawn
   * ```
   *
   * An entity with a `RigidBodyComponent` must be moved through
   * `rb.setPosition(x, y)` instead — physics owns the transform of a dynamic
   * body and overwrites a direct `Transform` write on the next frame.
   */
  setActive(active: boolean): void {
    if (this._activeSelf === active) return;
    this._activeSelf = active;
    this._resyncActive();
  }

  /** The parent entity, or null if this is a root entity. */
  get parent(): Entity | null {
    return this._parent;
  }

  /** Named children as a read-only map. Empty map if no children. */
  get children(): ReadonlyMap<string, Entity> {
    return this._children ?? EMPTY_CHILDREN;
  }

  /** Add a named child entity. Auto-adds to parent's scene if not already in one. */
  addChild(name: string, child: Entity): void {
    if (child === this) {
      throw new Error(`Entity "${this.name}" cannot be a child of itself.`);
    }
    // Destruction is deferred, so a destroyed parent is still reachable until
    // the end-of-frame flush. Its cascade has already run, so a child attached
    // now would never be destroyed with it and would outlive it in the scene.
    if (this._destroyed) {
      throw new Error(
        `Entity "${this.name}" is destroyed and cannot take a child.`,
      );
    }
    if (child._parent) {
      throw new Error(
        `Entity "${child.name}" already has a parent ("${child._parent.name}"). Remove it first.`,
      );
    }
    this._children ??= new Map();
    if (this._children.has(name)) {
      throw new Error(
        `Entity "${this.name}" already has a child named "${name}".`,
      );
    }
    child._parent = this;
    this._children.set(name, child);

    // Mark child transform dirty so world values recompute with new parent
    child.tryGet(Transform)?._markDirty();

    // Auto-add to parent's scene
    if (this._scene && !child._scene) {
      this._scene._addExistingEntity(child);
    }

    // The subtree inherits the new parent's activeness.
    child._resyncActive();
  }

  /**
   * Spawn a new entity in this entity's scene and add it as a named child.
   * Combines `scene.spawn(...)` + `this.addChild(name, ...)` in one call —
   * the idiomatic way to compose entity trees (logical root + visual body
   * + UI sibling + ...).
   *
   * Mirrors the overload shape of `Scene.spawn`: pass an Entity subclass
   * (with optional setup params), a `Blueprint`, or omit for an anonymous
   * base Entity.
   *
   * ```ts
   * this.spawnChild("body", EnemyBody, { color: 0xff6b6b });
   * this.spawnChild("hp", EnemyHealthBar);
   * ```
   */
  spawnChild(name: string, options?: SpawnOptions): Entity;
  spawnChild<E extends Entity>(
    name: string,
    Class: new () => E,
    ...rest: ClassSpawnArgs<E>
  ): E;
  spawnChild<P>(
    name: string,
    blueprint: Blueprint<P>,
    params: P,
    options?: SpawnOptions,
  ): Entity;
  spawnChild(
    name: string,
    blueprint: Blueprint<void>,
    options?: SpawnOptions,
  ): Entity;
  spawnChild(
    name: string,
    classOrBlueprintOrOptions?:
      | (new () => Entity)
      | Blueprint<unknown>
      | SpawnOptions,
    paramsOrOptions?: unknown,
    maybeOptions?: SpawnOptions,
  ): Entity {
    const scene = this.scene;
    // Validate before spawning so we don't leave an orphan entity in the
    // scene if addChild would reject the name. addChild also throws on
    // these, but by then the spawn side-effects (scene.entities insert,
    // `entity:created` emit, setup() / blueprint.build()) have all run.
    if (this._destroyed) {
      throw new Error(
        `Entity "${this.name}" is destroyed and cannot spawn a child.`,
      );
    }
    if (this._children?.has(name)) {
      throw new Error(
        `Entity "${this.name}" already has a child named "${name}".`,
      );
    }
    // The public overloads above keep callsites type-safe. The
    // implementation signature is intentionally loose so it can funnel
    // into `Scene.spawn`'s matching overloads without per-variant
    // branches. When no class/blueprint is provided, forward `name` as
    // the entity's own name so `child.name` matches the child-map key.
    // Spawning runs `setup()` before `addChild` links the parent, so a child of
    // a dormant parent would otherwise be active for that window and fire
    // enable hooks the link immediately undoes. Hold it inert instead and let
    // `addChild`'s resync settle the subtree once.
    const inert = !this._activeInHierarchy;
    if (inert) scene._spawnInert = true;
    let child: Entity;
    try {
      if (classOrBlueprintOrOptions === undefined) {
        child = scene.spawn(name);
      } else if (
        typeof classOrBlueprintOrOptions === "object" &&
        !("build" in classOrBlueprintOrOptions)
      ) {
        // spawnChild(name, options)
        child = scene.spawn(name, classOrBlueprintOrOptions as SpawnOptions);
      } else {
        child = (
          scene.spawn as (a?: unknown, b?: unknown, c?: unknown) => Entity
        )(classOrBlueprintOrOptions, paramsOrOptions, maybeOptions);
      }
    } finally {
      if (inert) scene._spawnInert = false;
    }
    this.addChild(name, child);
    return child;
  }

  /** Remove a named child. Returns the detached entity. */
  removeChild(name: string): Entity {
    const child = this._children?.get(name);
    if (!child) {
      throw new Error(`Entity "${this.name}" has no child named "${name}".`);
    }
    child._parent = null;
    this._children!.delete(name);

    // Mark child transform dirty so world values recompute without parent
    child.tryGet(Transform)?._markDirty();

    // Detached from a dormant parent, the subtree goes by its own bits again.
    child._resyncActive();

    return child;
  }

  /** Get a child by name. Throws if not found. */
  getChild(name: string): Entity {
    const child = this._children?.get(name);
    if (!child) {
      throw new Error(`Entity "${this.name}" has no child named "${name}".`);
    }
    return child;
  }

  /** Get a child by name, or undefined if not found. */
  tryGetChild(name: string): Entity | undefined {
    return this._children?.get(name);
  }

  /** Add a component instance. Returns the component for chaining. */
  add<C extends Component>(component: C): C {
    const cls = component.constructor as ComponentClass;
    if (this.components.has(cls)) {
      throw new Error(
        `Entity "${this.name}" already has component ${cls.name}.`,
      );
    }
    component.entity = this;
    this.components.set(cls, component);
    component.onAdd?.();
    this.callbacks?.onComponentAdded(this, cls);
    component._refreshEnabled();
    return component;
  }

  /** Get a component by class. Throws if not found. */
  get<C extends Component>(cls: ComponentClass<C>): C {
    const comp = this.components.get(cls);
    if (!comp) {
      throw new Error(
        `Entity "${this.name}" does not have component ${cls.name}.`,
      );
    }
    return comp as C;
  }

  /** Get a component by class, or undefined if not found. */
  tryGet<C extends Component>(cls: ComponentClass<C>): C | undefined {
    return this.components.get(cls) as C | undefined;
  }

  /** Check if entity has a component of the given class. */
  has(cls: ComponentClass): boolean {
    return this.components.has(cls);
  }

  /** Remove a component by class. */
  remove(cls: ComponentClass): void {
    const comp = this.components.get(cls);
    if (!comp) return;
    comp._applyEnabled(false);
    comp._runCleanups();
    comp.onRemove?.();
    comp.onDestroy?.();
    this.components.delete(cls);
    this.callbacks?.onComponentRemoved(this, cls);
  }

  /** Subscribe to a typed event on this entity. Returns an unsubscribe function. */
  on<T>(token: EventToken<T>, handler: (data: T) => void): () => void {
    this._eventHandlers ??= new Map();
    let handlers = this._eventHandlers.get(token.name);
    if (!handlers) {
      handlers = new Set();
      this._eventHandlers.set(token.name, handlers);
    }
    handlers.add(handler as (data: never) => void);

    return () => {
      handlers.delete(handler as (data: never) => void);
    };
  }

  /** Emit a typed event on this entity. Bubbles to the scene. */
  emit(token: EventToken<void>): void;
  emit<T>(token: EventToken<T>, data: T): void;
  emit<T>(token: EventToken<T>, data?: T): void {
    if (this._destroyed) return;

    const handlers = this._eventHandlers?.get(token.name);
    if (handlers && handlers.size > 0) {
      const boundary = this._scene?.context.tryResolve(ErrorBoundaryKey);
      const sceneName = this._scene?.name;
      // Snapshot for safe unsubscribe during iteration
      for (const handler of [...handlers]) {
        if (boundary) {
          boundary.wrapCallback(() => handler(data as never), {
            kind: "Entity event handler",
            entity: this.name,
            event: token.name,
            ...(sceneName !== undefined ? { scene: sceneName } : {}),
          });
        } else {
          handler(data as never);
        }
      }
    }

    this._scene?._onEntityEvent(token.name, data, this);
    this._scene?._observeEntityEvent(token.name, data, this);
  }

  /** Get all components as an iterable. */
  getAll(): Iterable<Component> {
    return this.components.values();
  }

  /**
   * Retire the entity. For an ordinary entity that means deferred
   * destruction, with the real cleanup at end of frame.
   *
   * A pool member is retired by going back to its pool instead — its pool
   * owns its lifetime and destroys it only when the pool itself is disposed.
   * That keeps `destroy()` usable from the places retirement is actually
   * decided: a collision handler, an update, an event listener, all of which
   * see a plain `Entity` and hold no pool reference.
   */
  destroy(): void {
    if (this._destroyed) return;
    if (this._pool) {
      this._pool._releaseMember(this);
      return;
    }
    this._destroyOwned();
  }

  /**
   * Internal: destroy for real, skipping the pool redirect. Used by the
   * owning pool when it disposes, and by the cascade below.
   * @internal
   */
  _destroyOwned(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    // Cascade to children. Releasing a pooled child runs its `onRelease` and
    // its components' `onDisable`, so game code executes in here — the queue
    // step has to survive a throw from it, or this entity would stay marked
    // destroyed and never actually be torn down.
    try {
      if (this._children) {
        for (const [name, child] of [...this._children]) {
          if (child._pool) {
            // A member hung under this entity outlives it. Detach it and hand
            // it back rather than destroy something the pool owns.
            this.removeChild(name);
            child._pool._releaseMember(child);
          } else {
            child._destroyOwned();
          }
        }
      }
    } finally {
      this._scene?._queueDestroy(this);
    }
  }

  /**
   * Internal: recompute effective activeness against the current parent and
   * propagate to descendants. Called after `setActive`, after a re-parent,
   * and once per restored root when a snapshot finishes rebuilding the
   * hierarchy.
   * @internal
   */
  _resyncActive(): void {
    this._applyActive(this._parent ? this._parent._activeInHierarchy : true);
  }

  /**
   * Internal: write `activeSelf` and park the entity as dormant without
   * firing hooks or touching queries. Used by snapshot restore, which must
   * hold every restored entity inert until the parent links are back — the
   * single `_resyncActive` per root afterwards fires each hook exactly once.
   * @internal
   */
  _setActiveSuppressed(activeSelf: boolean): void {
    this._activeSelf = activeSelf;
    this._activeInHierarchy = false;
  }

  /**
   * Apply an ancestor's effective activeness to this entity and, on a flip,
   * to its whole subtree. Query membership is added before the enable hooks
   * and removed after the disable hooks, so a hook always runs while the
   * entity is still a query member and can reach its siblings through one.
   */
  private _applyActive(parentActive: boolean): void {
    const next = parentActive && this._activeSelf;
    // Unchanged here means unchanged for every descendant too — their cached
    // bits were computed against this same value.
    if (next === this._activeInHierarchy) return;
    // A destroyed entity is waiting for the end-of-frame flush. An activation
    // must not walk into it: rejoining queries or reacquiring a body and a
    // display object it is about to release leaves systems iterating an entity
    // on its way out. Its children are destroyed with it, so stopping here
    // strands no live descendant. Deactivation still propagates — releasing
    // those resources early is harmless.
    if (next && this._destroyed) return;
    this._activeInHierarchy = next;

    if (next) {
      this.callbacks?.onEntityActivated(this);
      for (const comp of this.components.values()) comp._refreshEnabled();
    } else {
      for (const comp of this.components.values()) comp._refreshEnabled();
      this.callbacks?.onEntityDeactivated(this);
    }

    if (this._children) {
      for (const child of this._children.values()) child._applyActive(next);
    }
  }

  /**
   * Internal: mark the entity destroyed without queueing it. Called by Scene
   * during teardown so every entity reads `isDestroyed === true` before any
   * component `onDestroy` runs. Idempotent.
   * @internal
   */
  _markDestroyed(): void {
    this._destroyed = true;
  }

  /**
   * Internal: perform actual destruction — remove all components and clear state.
   * Called by Scene during endOfFrame flush.
   * @internal
   */
  _performDestroy(): void {
    // Detach from parent
    if (this._parent?._children) {
      for (const [name, child] of this._parent._children) {
        if (child === this) {
          this._parent._children.delete(name);
          break;
        }
      }
    }
    this._parent = null;

    // Clear own children references (they are destroyed separately via cascade)
    this._children?.clear();

    for (const [cls, comp] of this.components) {
      comp._applyEnabled(false);
      comp._runCleanups();
      comp.onRemove?.();
      comp.onDestroy?.();
      this.callbacks?.onComponentRemoved(this, cls);
    }
    this.components.clear();
    this._eventHandlers?.clear();

    // Detach from the scene last, so component onDestroy hooks above can
    // still read `entity.scene`. After this, `scene` throws and `tryScene`
    // returns null.
    this._setScene(null, null);
  }

  /**
   * Optional setup method. Called by `scene.spawn(Class, params)` after the
   * entity is wired to its scene, so components can access services.
   * Override in subclasses — do NOT use the constructor for component setup.
   */
  setup?(params: unknown): void;

  /**
   * Per-reuse reset, called by {@link EntityPool} every time the entity is
   * handed out — including the first time, right after `setup()`. Its
   * parameters become the pool's `acquire(...)` arguments, so a bullet that
   * needs a position and a direction declares
   * `onAcquire(x: number, y: number, dir: Vec2)`.
   *
   * A pooled class must declare this hook: nothing else resets the state the
   * entity kept while dormant. Declare an empty one if there is genuinely
   * nothing to reset. It runs on a fully active entity, and must be
   * synchronous and non-overloaded — the pool derives `acquire`'s signature
   * from it, and a set of overloads keeps only the last.
   */
  onAcquire?(...args: unknown[]): void;

  /**
   * Called by {@link EntityPool} when the entity is released, before it goes
   * dormant. Optional even for pooled classes: turning components off is the
   * job of `onDisable`, so this is for game-level cleanup — dropping a
   * target reference, clearing a listener registered outside `setup()`.
   */
  onRelease?(): void;

  /** Return a JSON-serializable snapshot of this entity's custom state. Used by the save system. */
  serialize?(): unknown;

  /** Called after components are restored during save/load. Rebuild non-serializable state here. */
  afterRestore?(data: unknown, resolve: SnapshotResolver): void;

  /** Check if this entity's class implements a given trait. Acts as a type guard. */
  hasTrait<T>(token: TraitToken<T>): this is this & T {
    return entityClassHasTrait(this.constructor as new () => Entity, token);
  }

  /**
   * Return the stable key, or throw if this entity was spawned without one.
   * Use inside component `setup()` when the component depends on identity
   * (e.g. reading from a `createSet` keyed by entity key).
   */
  requireKey(): string {
    if (this.key === undefined) {
      throw new Error(
        `Entity "${this.name}" (id=${this.id}) has no stable key. ` +
          `Pass { key: "..." } to scene.spawn(...) or entity.spawnChild(...).`,
      );
    }
    return this.key;
  }

  /**
   * Internal: set the scene and callbacks. Called by Scene.spawn().
   * @internal
   */
  _setScene(scene: Scene | null, callbacks: EntityCallbacks | null): void {
    this._scene = scene;
    this.callbacks = callbacks;
  }

  /**
   * Internal: assign the stable identity key. Called by `Scene._registerKey`
   * during spawn. Throws if the entity already has a key — keys are
   * immutable for an entity's lifetime.
   * @internal
   */
  _setKey(key: string): void {
    if (this.key !== undefined) {
      throw new Error(`Entity "${this.name}" already has key "${this.key}".`);
    }
    (this as { key?: string }).key = key;
  }
}
