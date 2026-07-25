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
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsWorldKey } from "./types.js";
import type { ColliderConfig, CollisionEvent, TriggerEvent } from "./types.js";

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

  private readonly rb = this.sibling(RigidBodyComponent);
  private physicsWorld!: PhysicsWorld;
  private errorBoundary: ErrorBoundary | undefined;
  private collisionHandlers: Array<(e: CollisionEvent) => void> = [];
  private triggerHandlers: Array<(e: TriggerEvent) => void> = [];
  private _warnedSensorMismatch = false;

  constructor(config: ColliderConfig) {
    super();
    this.config = config;
  }

  onAdd(): void {
    // Resolve before creating the Rapier collider: an optional lookup can't
    // throw, so a hand-built test context with no boundary registered still
    // leaves onAdd fully completed rather than half-done.
    this.errorBoundary = this.context.tryResolve(ErrorBoundaryKey);
    this.physicsWorld = this.use(PhysicsWorldKey);

    this._colliderHandle = this.physicsWorld.createCollider(
      this.entity,
      this.rb._bodyHandle,
      this.config,
      this,
    );

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
  getOverlapping<T>(filter: EntityFilter & { trait: TraitToken<T> }): (Entity & T)[];
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
    this._dispatch(this.collisionHandlers, (h) => h(event), "Collision handler");
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
