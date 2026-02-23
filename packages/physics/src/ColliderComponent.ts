import { Component } from "@yage/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsWorldKey } from "./types.js";
import type { ColliderConfig, CollisionEvent, TriggerEvent } from "./types.js";

/**
 * Wraps a Rapier collider. Attach after RigidBodyComponent.
 *
 * Component ordering: Transform → RigidBodyComponent → ColliderComponent.
 */
export class ColliderComponent extends Component {
  /** Collider configuration (shape, sensor, etc.). */
  readonly config: ColliderConfig;

  /** @internal Rapier collider handle, set during onAdd. */
  _colliderHandle = -1;

  private physicsWorld!: PhysicsWorld;
  private collisionHandlers: Array<(e: CollisionEvent) => void> = [];
  private triggerHandlers: Array<(e: TriggerEvent) => void> = [];

  constructor(config: ColliderConfig) {
    super();
    this.config = config;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);
    const rb = this.entity.get(RigidBodyComponent);

    this._colliderHandle = this.physicsWorld.createCollider(
      this.entity,
      rb._bodyHandle,
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

  /** Set whether this collider is a sensor. */
  setSensor(sensor: boolean): void {
    const collider = this.physicsWorld.getCollider(this._colliderHandle);
    if (collider) {
      collider.setSensor(sensor);
    }
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
