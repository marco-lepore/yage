import { Component, filterEntities, serializable } from "@yagejs/core";
import type { Entity, ComponentClass, EntityFilter, TraitToken } from "@yagejs/core";
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
  /** Collider configuration (shape, sensor, etc.). */
  readonly config: ColliderConfig;

  /** @internal Rapier collider handle, set during onAdd. */
  _colliderHandle = -1;

  private readonly rb = this.sibling(RigidBodyComponent);
  private physicsWorld!: PhysicsWorld;
  private collisionHandlers: Array<(e: CollisionEvent) => void> = [];
  private triggerHandlers: Array<(e: TriggerEvent) => void> = [];

  constructor(config: ColliderConfig) {
    super();
    this.config = config;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    this._colliderHandle = this.physicsWorld.createCollider(
      this.entity,
      this.rb._bodyHandle,
      this.config,
      this,
    );
  }

  onDestroy(): void {
    this.collisionHandlers.length = 0;
    this.triggerHandlers.length = 0;
  }

  /** Subscribe to collision events. Returns an unsubscribe function. */
  onCollision(handler: (e: CollisionEvent) => void): () => void {
    this.collisionHandlers.push(handler);
    return () => {
      const idx = this.collisionHandlers.indexOf(handler);
      if (idx !== -1) this.collisionHandlers.splice(idx, 1);
    };
  }

  /** Subscribe to trigger events (sensor). Returns an unsubscribe function. */
  onTrigger(handler: (e: TriggerEvent) => void): () => void {
    this.triggerHandlers.push(handler);
    return () => {
      const idx = this.triggerHandlers.indexOf(handler);
      if (idx !== -1) this.triggerHandlers.splice(idx, 1);
    };
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

  /** Set whether this collider is a sensor. */
  setSensor(sensor: boolean): void {
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
    for (const handler of this.collisionHandlers) {
      handler(event);
    }
  }

  /**
   * @internal Called by PhysicsWorld during event dispatch.
   */
  _dispatchTrigger(event: TriggerEvent): void {
    for (const handler of this.triggerHandlers) {
      handler(event);
    }
  }
}
