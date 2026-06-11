import type { Component } from "./Component.js";
import type { ComponentClass } from "./types.js";
import type { EventToken } from "./EventToken.js";
import type { Blueprint } from "./Blueprint.js";
import type { SnapshotResolver } from "./Serializable.js";
import type { Scene, SpawnOptions } from "./Scene.js";
import { TRAITS_KEY, type TraitToken } from "./Trait.js";
import { Transform } from "./Transform.js";

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
   * `addChild` wires it up, or after `destroy()` tears it down. Inside
   * lifecycle methods (`setup`, component `onAdd`, `update`, etc.) this is
   * always safe to access.
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

  /** True if destroy() has been called. */
  get isDestroyed(): boolean {
    return this._destroyed;
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
    options?: SpawnOptions,
  ): E;
  spawnChild<E extends Entity, P>(
    name: string,
    Class: new () => E & { setup(params: P): void },
    params: P,
    options?: SpawnOptions,
  ): E;
  spawnChild<P>(
    name: string,
    blueprint: Blueprint<P>,
    params: P,
    options?: SpawnOptions,
  ): Entity;
  // eslint-disable-next-line @typescript-eslint/unified-signatures -- preserves Class return-type narrowing on the overload above
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
    // this, but by then the spawn side-effects (scene.entities insert,
    // `entity:created` emit, setup() / blueprint.build()) have all run.
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
    let child: Entity;
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
    if (handlers) {
      // Snapshot for safe unsubscribe during iteration
      for (const handler of [...handlers]) {
        handler(data as never);
      }
    }

    this._scene?._onEntityEvent(token.name, data, this);
    this._scene?._observeEntityEvent(token.name, data, this);
  }

  /** Get all components as an iterable. */
  getAll(): Iterable<Component> {
    return this.components.values();
  }

  /** Mark for deferred destruction. Actual cleanup happens at end of frame. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    // Cascade to children
    if (this._children) {
      for (const child of this._children.values()) {
        child.destroy();
      }
    }

    this._scene?._queueDestroy(this);
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
      comp._runCleanups();
      comp.onRemove?.();
      comp.onDestroy?.();
      this.callbacks?.onComponentRemoved(this, cls);
    }
    this.components.clear();
    this._eventHandlers?.clear();
  }

  /**
   * Optional setup method. Called by `scene.spawn(Class, params)` after the
   * entity is wired to its scene, so components can access services.
   * Override in subclasses — do NOT use the constructor for component setup.
   */
  setup?(params: unknown): void;

  /** Return a JSON-serializable snapshot of this entity's custom state. Used by the save system. */
  serialize?(): unknown;

  /** Called after components are restored during save/load. Rebuild non-serializable state here. */
  afterRestore?(data: unknown, resolve: SnapshotResolver): void;

  /** Check if this entity's class implements a given trait. Acts as a type guard. */
  hasTrait<T>(token: TraitToken<T>): this is this & T {
    // Walk the constructor chain so plain subclasses inherit parent traits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctor: any = this.constructor;
    while (ctor) {
      const traits = ctor[TRAITS_KEY] as Set<symbol> | undefined;
      if (traits?.has(token.symbol)) return true;
      ctor = Object.getPrototypeOf(ctor);
    }
    return false;
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
  _setScene(
    scene: Scene | null,
    callbacks: EntityCallbacks | null,
  ): void {
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
      throw new Error(
        `Entity "${this.name}" already has key "${this.key}".`,
      );
    }
    (this as { key?: string }).key = key;
  }
}
