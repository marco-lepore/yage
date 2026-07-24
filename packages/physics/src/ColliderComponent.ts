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

  /**
   * Shared dispatch for collision/trigger handlers. Iterates a snapshot,
   * not the live array — the unsubscribe closures `splice` the live array
   * (`onCollision`/`onTrigger` above), and removing index *i* mid-iteration
   * would shift the next handler into that slot and skip it. A throwing
   * handler is removed so it can't throw again next frame; `reported`
   * guards against invoking the same handler twice in one dispatch when
   * it's registered more than once (arrays, unlike the Set-backed entity/
   * scene listeners, permit duplicates). Allocated only once a handler
   * actually throws, so a clean dispatch — the overwhelming majority, every
   * frame, for every collider — costs only the snapshot array.
   */
  private _dispatch<H>(
    live: H[],
    invoke: (handler: H) => void,
    kind: string,
  ): void {
    let reported: Set<H> | undefined;
    const sceneName = this.entity?.tryScene?.name;
    for (const handler of [...live]) {
      if (reported?.has(handler)) continue;
      if (this.errorBoundary) {
        this.errorBoundary.wrapCallback(
          () => invoke(handler),
          {
            kind,
            entity: this.entity?.name,
            ...(sceneName !== undefined ? { scene: sceneName } : {}),
          },
          "removed",
          {
            onError: () => {
              (reported ??= new Set()).add(handler);
              const idx = live.indexOf(handler);
              if (idx !== -1) live.splice(idx, 1);
            },
          },
        );
      } else {
        invoke(handler);
      }
    }
  }
}
