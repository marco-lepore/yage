import {
  Component,
  devWarn,
  filterEntities,
  serializable,
  ErrorBoundaryKey,
} from "@yagejs/core";
import type {
  Entity,
  ComponentClass,
  EntityFilter,
  TraitToken,
  ErrorBoundary,
} from "@yagejs/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { createOneWayFilter } from "./oneWay.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsWorldKey } from "./types.js";
import type {
  ColliderConfig,
  ColliderShape,
  CollisionEvent,
  ContactCandidate,
  ContactFilter,
  TriggerEvent,
} from "./types.js";

/** Serialized snapshot of a ColliderComponent. */
export interface ColliderData {
  config: ColliderConfig;
}

/**
 * Wraps a Rapier collider. Attach after RigidBodyComponent.
 *
 * Component ordering: Transform → RigidBodyComponent → ColliderComponent.
 */
@serializable
export class ColliderComponent extends Component {
  // onAdd() attaches to the sibling RigidBodyComponent's body handle.
  static restorePriority = 20;

  /** Collider configuration (shape, sensor, etc.). */
  readonly config: ColliderConfig;

  /** @internal Rapier collider handle, set during onAdd. */
  _colliderHandle = -1;

  /** @internal Active contact filter, read by PhysicsWorld's pair hook. */
  _contactFilter: ContactFilter | null = null;

  /**
   * @internal Collider handles of riders whose contact with this one-way
   * platform has started and not yet ended. While a rider is in here the
   * platform stays solid for it regardless of the position rule — a deep
   * first-impact penetration must not flip an established landing back to
   * passable while the solver is still pushing the rider out. Maintained by
   * PhysicsWorld from collision start/end events and collider removal;
   * `null` unless the collider is configured `oneWay`.
   */
  _oneWayLanded: Set<number> | null = null;

  private readonly rb = this.sibling(RigidBodyComponent);
  private physicsWorld!: PhysicsWorld;
  private errorBoundary: ErrorBoundary | undefined;
  private collisionHandlers: Array<(e: CollisionEvent) => void> = [];
  private triggerHandlers: Array<(e: TriggerEvent) => void> = [];
  private _warnedSensorMismatch = false;
  /** Simulated-time deadline (PhysicsWorld.elapsed) for drop-through. */
  private _dropThroughUntil = -1;
  /** Drop-through seconds requested before the collider existed. */
  private _pendingDropThrough = 0;
  /** True once the current filter's failure has been reported. */
  private _reportedFilterError = false;
  /** The filter `config.oneWay` installed, to tell it apart from a custom one. */
  private _oneWayFilter: ContactFilter | null = null;

  constructor(config: ColliderConfig) {
    super();
    this.config = config;
    if (config.oneWay) {
      this._oneWayLanded = new Set();
      this._oneWayFilter = createOneWayFilter(this);
      this._contactFilter = this._oneWayFilter;
    }
  }

  /**
   * @internal True while the collider's active filter is still the one
   * `config.oneWay` installed — the debug overlay draws one-way visuals
   * only then, so a custom filter set over the preset isn't shown as
   * one-way.
   */
  get _oneWayFilterActive(): boolean {
    return this._contactFilter !== null && this._contactFilter === this._oneWayFilter;
  }

  onAdd(): void {
    // Resolve before creating the Rapier collider: an optional lookup can't
    // throw, so a hand-built test context with no boundary registered still
    // leaves onAdd fully completed rather than half-done.
    this.errorBoundary = this.context.tryResolve(ErrorBoundaryKey);
    this.physicsWorld = this.use(PhysicsWorldKey);

    if (this.config.oneWay && this.config.sensor) {
      devWarn(
        `ColliderComponent at ${this.entity.name}: oneWay has no effect on a ` +
          `sensor — contact filters only run for solid contact pairs.`,
      );
    }

    this._colliderHandle = this.physicsWorld.createCollider(
      this.entity,
      this.rb._bodyHandle,
      this.config,
      this,
    );

    if (this._pendingDropThrough > 0) {
      this._dropThroughUntil =
        this.physicsWorld.elapsed + this._pendingDropThrough;
      this._pendingDropThrough = 0;
    }

    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Rapier creates a
    // collider enabled, so without this a collider added to a dormant entity
    // would stay in the simulation and report contacts.
    this.physicsWorld.getCollider(this._colliderHandle)?.setEnabled(false);
  }

  /**
   * Take the collider out of the simulation, keeping its Rapier allocation.
   * Rapier does not re-emit a collision-start for a collider disabled and
   * re-enabled while still overlapping something — a reused entity dropped
   * onto an existing contact gets no `onCollision` for it.
   */
  onDisable(): void {
    this.physicsWorld.getCollider(this._colliderHandle)?.setEnabled(false);
    // A pooled entity keeps its components; a drop-through window from the
    // previous life must not carry into the next one.
    this._dropThroughUntil = -1;
    this._pendingDropThrough = 0;
    // Landing state must not survive a dormancy either — neither this
    // platform's remembered riders nor any platform remembering this
    // collider. Contacts end silently on disable, so clean up here.
    this._oneWayLanded?.clear();
    this.physicsWorld._forgetColliderContacts(this._colliderHandle);
  }

  onEnable(): void {
    this.physicsWorld.getCollider(this._colliderHandle)?.setEnabled(true);
  }

  onDestroy(): void {
    if (this._colliderHandle !== -1) {
      this.physicsWorld.removeCollider(this._colliderHandle);
      this._colliderHandle = -1;
    }
    this.collisionHandlers.length = 0;
    this.triggerHandlers.length = 0;
  }

  /** Subscribe to collision events. Returns an unsubscribe function. */
  onCollision(handler: (e: CollisionEvent) => void): () => void {
    this._warnSensorMismatch("onCollision");
    this.collisionHandlers.push(handler);
    return () => {
      const idx = this.collisionHandlers.indexOf(handler);
      if (idx !== -1) this.collisionHandlers.splice(idx, 1);
    };
  }

  /** Subscribe to trigger events (sensor). Returns an unsubscribe function. */
  onTrigger(handler: (e: TriggerEvent) => void): () => void {
    this._warnSensorMismatch("onTrigger");
    this.triggerHandlers.push(handler);
    return () => {
      const idx = this.triggerHandlers.indexOf(handler);
      if (idx !== -1) this.triggerHandlers.splice(idx, 1);
    };
  }

  private _warnSensorMismatch(handler: "onCollision" | "onTrigger"): void {
    if (this._warnedSensorMismatch) return;
    const sensor = this.config.sensor === true;
    if (sensor && handler === "onCollision") {
      this._warnedSensorMismatch = true;
      const name = this.entity?.name ?? "<unbound>";
      devWarn(
        `ColliderComponent at ${name}: sensor: true colliders fire onTrigger, ` +
          `not onCollision. Did you mean .onTrigger(...)?`,
      );
    } else if (!sensor && handler === "onTrigger") {
      this._warnedSensorMismatch = true;
      const name = this.entity?.name ?? "<unbound>";
      devWarn(
        `ColliderComponent at ${name}: solid colliders fire onCollision, ` +
          `not onTrigger. Did you mean .onCollision(...), or set sensor: true on the collider?`,
      );
    }
  }

  /** Return all entities whose colliders currently overlap this one, optionally filtered. */
  getOverlapping<T>(
    filter: EntityFilter & { trait: TraitToken<T> },
  ): (Entity & T)[];
  getOverlapping(filter?: EntityFilter): Entity[];
  getOverlapping(filter?: EntityFilter): Entity[] {
    const entities = this.physicsWorld.queryOverlapping(this._colliderHandle);
    return filter ? filterEntities(entities, filter) : entities;
  }

  /** Return components of type C from all overlapping entities that have one. */
  getOverlappingComponents<C extends Component>(cls: ComponentClass<C>): C[] {
    const result: C[] = [];
    for (const entity of this.getOverlapping()) {
      const comp = entity.tryGet(cls);
      if (comp) result.push(comp);
    }
    return result;
  }

  /** Set whether this collider is a sensor. Callable before the component
   * is added — the updated config is applied at collider creation. */
  setSensor(sensor: boolean): void {
    // Event routing, the sensor-mismatch warning, and serialize() all read
    // config.sensor, so it must track the live collider.
    this.config.sensor = sensor;
    // Before onAdd there is no physics world or collider yet; the config
    // write above is all that's needed.
    if (this._colliderHandle === -1) return;
    const collider = this.physicsWorld.getCollider(this._colliderHandle);
    if (collider) {
      collider.setSensor(sensor);
    }
  }

  /**
   * Replace the collider's shape in place, in pixels like the rest of
   * `ColliderConfig`. The Rapier collider, its body attachment, and every
   * `onCollision`/`onTrigger` subscription survive the swap, so a crouch or
   * slide can shrink the collider and restore it without removing and
   * re-adding the component.
   *
   * The body keeps the mass it already had. A collider is a collision proxy,
   * not a measure of how much matter is there, so a character that crouches
   * takes the same knockback from `applyImpulse` as one standing up. Pass
   * `recomputeMass: true` when the new shape means genuinely more or less
   * matter, and the body's mass should come back from density × the new
   * shape.
   *
   * Shrinking never pushes anything out of the way, and growing can leave the
   * collider overlapping geometry it clears at the smaller size. Check
   * clearance (`PhysicsWorld.queryShape` at the target size) before growing
   * back.
   *
   * Callable before the component is added — the updated config is applied at
   * collider creation. A pre-add call cannot recompute mass: the body takes
   * its mass from the new shape at creation anyway.
   */
  setShape(shape: ColliderShape, options?: { recomputeMass?: boolean }): void {
    // serialize() and the shape-dependent dev warnings read config.shape.
    this.config.shape = shape;
    if (this._colliderHandle === -1) return;
    this.physicsWorld.setColliderShape(
      this._colliderHandle,
      this.config,
      options,
    );
  }

  /**
   * Set (or clear, with `null`) this collider's contact filter — a per-pair
   * veto that decides each physics step whether a candidate contact with
   * another collider is solid (`true`) or passes through (`false`). Replaces
   * the built-in filter a `oneWay` config installed. Callable before the
   * component is added — the filter is armed at collider creation.
   *
   * The filter runs inside the physics step, so no contact normal exists
   * yet; the `ContactCandidate` exposes the two sides' positions and
   * velocities instead. The candidate is a single reused instance — read
   * what you need inside the filter and copy it; a stored reference shows
   * other pairs' values after the call returns. A filter that throws is
   * reported through the error boundary once (per installed filter) and
   * the pair stays solid.
   *
   * Filters are functions and are not serialized: after a save/load, a
   * collider configured with `oneWay` gets its built-in filter back, and a
   * custom filter must be reinstalled by the game.
   */
  setContactFilter(filter: ContactFilter | null): void {
    this._contactFilter = filter;
    this._reportedFilterError = false;
    if (this._colliderHandle === -1) return;
    this.physicsWorld._setContactFilterEnabled(
      this._colliderHandle,
      filter !== null,
    );
  }

  /**
   * Let this body fall through one-way platforms for the next `seconds`
   * seconds of simulated time — the standard down-jump. Only this body is
   * affected; other bodies standing on the same platform stay supported.
   * When the window expires mid-platform, the body keeps falling until it
   * is clear and lands on the next solid side it reaches from above.
   *
   * Callable before the component is added; the window then starts when the
   * collider is created.
   */
  dropThrough(seconds: number): void {
    if (this._colliderHandle === -1) {
      this._pendingDropThrough = seconds;
      return;
    }
    this._dropThroughUntil = this.physicsWorld.elapsed + seconds;
    // A body that has been resting long enough is asleep, and sleeping
    // pairs are never re-filtered — wake it so the window can take effect.
    this.physicsWorld.getBody(this.rb._bodyHandle)?.wakeUp();
  }

  /** True while a `dropThrough` window is active for this collider. */
  get isDroppingThrough(): boolean {
    return (
      this._colliderHandle !== -1 &&
      this.physicsWorld.elapsed < this._dropThroughUntil
    );
  }

  /**
   * @internal Run the contact filter for a candidate pair.
   *
   * Deliberate exception to the report-and-rethrow rule for developer
   * callbacks: this is called from inside Rapier's WASM step, and a throw
   * unwinding through WASM mid-step leaves the physics world in an
   * undefined state. The error is caught, reported through the boundary,
   * and the pair falls back to solid — the conservative default.
   *
   * Reported once per installed filter, not per throw: the filter runs for
   * every candidate pair every step, and a persistently throwing one would
   * otherwise log at frame rate and evict everything else from the error
   * snapshot. `setContactFilter` re-arms the report.
   */
  _evaluateContactFilter(contact: ContactCandidate): boolean {
    const filter = this._contactFilter;
    if (!filter) return true;
    try {
      return filter(contact);
    } catch (err) {
      if (this._reportedFilterError) return true;
      this._reportedFilterError = true;
      const sceneName = this.entity?.tryScene?.name;
      this.errorBoundary?.reportLifecycleError(err, {
        kind: "Contact filter",
        entity: this.entity?.name,
        ...(sceneName !== undefined ? { scene: sceneName } : {}),
      });
      return true;
    }
  }

  /** Serialize the component into a plain data object. */
  serialize(): ColliderData {
    return { config: this.config };
  }

  /** Create a ColliderComponent from a serialized snapshot. */
  static fromSnapshot(data: ColliderData): ColliderComponent {
    return new ColliderComponent(data.config);
  }

  /**
   * @internal Called by PhysicsWorld during event dispatch.
   */
  _dispatchCollision(event: CollisionEvent): void {
    this._dispatch(
      this.collisionHandlers,
      (h) => h(event),
      "Collision handler",
    );
  }

  /**
   * @internal Called by PhysicsWorld during event dispatch.
   */
  _dispatchTrigger(event: TriggerEvent): void {
    this._dispatch(this.triggerHandlers, (h) => h(event), "Trigger handler");
  }

  /** Shared dispatch for collision/trigger handlers. */
  private _dispatch<H>(
    live: H[],
    invoke: (handler: H) => void,
    kind: string,
  ): void {
    // Events are drained after the step, so a collider disabled mid-frame can
    // still have queued events naming it. A dormant entity must not see them.
    if (this.entity?.isActive === false) return;
    const sceneName = this.entity?.tryScene?.name;
    // Snapshot: `onCollision`/`onTrigger` hand back an unsubscribe that
    // splices this array, so a handler removing itself mid-dispatch would
    // otherwise shift the next one past the iterator.
    for (const handler of [...live]) {
      if (this.errorBoundary) {
        this.errorBoundary.wrapCallback(() => invoke(handler), {
          kind,
          entity: this.entity?.name,
          ...(sceneName !== undefined ? { scene: sceneName } : {}),
        });
      } else {
        invoke(handler);
      }
    }
  }
}
