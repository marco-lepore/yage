import RAPIER from "@dimforge/rapier2d";
import { Vec2 } from "@yage/core";
import type { Entity, Vec2Like } from "@yage/core";
import { CollisionLayers } from "./CollisionLayers.js";
import type {
  PhysicsConfig,
  RigidBodyConfig,
  ColliderConfig,
  ColliderShape,
  RaycastHit,
} from "./types.js";
import type { ColliderComponent } from "./ColliderComponent.js";

const DEFAULT_PIXELS_PER_METER = 50;
const DEFAULT_GRAVITY_X = 0;
const DEFAULT_GRAVITY_Y = 980; // pixels/s²

/**
 * Central Rapier2D wrapper. All public API values are in pixels.
 * Pixel-to-meter conversion is handled internally.
 */
export class PhysicsWorld {
  /** Pixels per meter conversion factor. */
  readonly pixelsPerMeter: number;

  /** Map from Rapier body handle to Entity. */
  readonly bodyMap = new Map<number, Entity>();
  /** Map from Rapier collider handle to Entity. */
  readonly colliderMap = new Map<number, Entity>();

  /** @internal Map from collider handle to ColliderComponent. */
  readonly _colliderComponents = new Map<number, ColliderComponent>();

  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;

  constructor(config?: PhysicsConfig) {
    this.pixelsPerMeter = config?.pixelsPerMeter ?? DEFAULT_PIXELS_PER_METER;
    const gx = config?.gravity?.x ?? DEFAULT_GRAVITY_X;
    const gy = config?.gravity?.y ?? DEFAULT_GRAVITY_Y;
    this.world = new RAPIER.World({
      x: this.toMeters(gx),
      y: this.toMeters(gy),
    });
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /** Convert pixels to meters. */
  toMeters(pixels: number): number {
    return pixels / this.pixelsPerMeter;
  }

  /** Convert meters to pixels. */
  toPixels(meters: number): number {
    return meters * this.pixelsPerMeter;
  }

  /** Step the physics simulation. dt is in seconds. */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
  }

  /** Drain collision events and dispatch to ColliderComponents. */
  processCollisionEvents(): void {
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const comp1 = this._colliderComponents.get(handle1);
      const comp2 = this._colliderComponents.get(handle2);
      const entity1 = this.colliderMap.get(handle1);
      const entity2 = this.colliderMap.get(handle2);

      if (comp1 && entity2 && comp2) {
        if (comp1.config.sensor) {
          comp1._dispatchTrigger({
            other: entity2,
            otherCollider: comp2,
            entered: started,
          });
        } else {
          comp1._dispatchCollision({
            other: entity2,
            otherCollider: comp2,
            started,
          });
        }
      }

      if (comp2 && entity1 && comp1) {
        if (comp2.config.sensor) {
          comp2._dispatchTrigger({
            other: entity1,
            otherCollider: comp1,
            entered: started,
          });
        } else {
          comp2._dispatchCollision({
            other: entity1,
            otherCollider: comp1,
            started,
          });
        }
      }
    });
  }

  /** Set gravity in pixels/s². */
  setGravity(x: number, y: number): void {
    this.world.gravity = { x: this.toMeters(x), y: this.toMeters(y) };
  }

  /** Create a rigid body and register it. Returns the Rapier handle. */
  createBody(entity: Entity, config: RigidBodyConfig): number {
    let desc: RAPIER.RigidBodyDesc;
    switch (config.type) {
      case "dynamic":
        desc = RAPIER.RigidBodyDesc.dynamic();
        break;
      case "static":
        desc = RAPIER.RigidBodyDesc.fixed();
        break;
      case "kinematic":
        desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        break;
    }

    if (config.linearDamping !== undefined) {
      desc.setLinearDamping(config.linearDamping);
    }
    if (config.angularDamping !== undefined) {
      desc.setAngularDamping(config.angularDamping);
    }
    if (config.fixedRotation) {
      desc.lockRotations();
    }
    if (config.gravityScale !== undefined) {
      desc.setGravityScale(config.gravityScale);
    }
    if (config.ccd) {
      desc.setCcdEnabled(true);
    }

    const body = this.world.createRigidBody(desc);
    this.bodyMap.set(body.handle, entity);
    return body.handle;
  }

  /** Create a collider attached to a body. Returns the Rapier collider handle. */
  createCollider(
    entity: Entity,
    bodyHandle: number,
    config: ColliderConfig,
    component: ColliderComponent,
  ): number {
    const body = this.world.getRigidBody(bodyHandle);
    const desc = this.buildColliderDesc(config.shape);

    if (config.offset) {
      desc.setTranslation(
        this.toMeters(config.offset.x),
        this.toMeters(config.offset.y),
      );
    }
    if (config.restitution !== undefined) {
      desc.setRestitution(config.restitution);
    }
    if (config.friction !== undefined) {
      desc.setFriction(config.friction);
    }
    if (config.density !== undefined) {
      desc.setDensity(config.density);
    }
    if (config.sensor) {
      desc.setSensor(true);
    }

    // Set collision groups
    if (config.layers !== undefined || config.mask !== undefined) {
      const membership = config.layers ?? 0xffff;
      const filter = config.mask ?? 0xffff;
      desc.setCollisionGroups(
        CollisionLayers.interactionGroups(membership, filter),
      );
    }

    // Enable collision events so we can dispatch them
    desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = this.world.createCollider(desc, body);
    this.colliderMap.set(collider.handle, entity);
    this._colliderComponents.set(collider.handle, component);
    return collider.handle;
  }

  /** Remove a rigid body and all its colliders from the world. */
  removeBody(handle: number): void {
    const body = this.world.getRigidBody(handle);
    if (!body) return;

    // Clean up collider mappings
    const numColliders = body.numColliders();
    for (let i = 0; i < numColliders; i++) {
      const collider = body.collider(i);
      this.colliderMap.delete(collider.handle);
      this._colliderComponents.delete(collider.handle);
    }

    this.world.removeRigidBody(body);
    this.bodyMap.delete(handle);
  }

  /** Get a Rapier rigid body by handle. */
  getBody(handle: number): RAPIER.RigidBody | undefined {
    try {
      return this.world.getRigidBody(handle);
    } catch {
      return undefined;
    }
  }

  /** Get a Rapier collider by handle. */
  getCollider(handle: number): RAPIER.Collider | undefined {
    try {
      return this.world.getCollider(handle);
    } catch {
      return undefined;
    }
  }

  /** Cast a ray and return the first hit. All values in pixels. */
  raycast(
    origin: Vec2Like,
    direction: Vec2Like,
    maxDistance: number,
    options?: { filterGroups?: number },
  ): RaycastHit | null {
    const ray = new RAPIER.Ray(
      { x: this.toMeters(origin.x), y: this.toMeters(origin.y) },
      { x: direction.x, y: direction.y },
    );

    const maxToi = this.toMeters(maxDistance);
    const result = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      options?.filterGroups,
    );

    if (!result) return null;

    const entity = this.colliderMap.get(result.collider.handle);
    if (!entity) return null;

    const hitPoint = ray.pointAt(result.timeOfImpact);
    return {
      entity,
      point: new Vec2(
        this.toPixels(hitPoint.x),
        this.toPixels(hitPoint.y),
      ),
      normal: new Vec2(result.normal.x, result.normal.y),
      distance: this.toPixels(result.timeOfImpact),
    };
  }

  /** Destroy the physics world and free resources. */
  destroy(): void {
    this.eventQueue.free();
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this._colliderComponents.clear();
  }

  // ---- Internal helpers ----

  private buildColliderDesc(shape: ColliderShape): RAPIER.ColliderDesc {
    switch (shape.type) {
      case "box":
        return RAPIER.ColliderDesc.cuboid(
          this.toMeters(shape.width / 2),
          this.toMeters(shape.height / 2),
        );
      case "circle":
        return RAPIER.ColliderDesc.ball(this.toMeters(shape.radius));
      case "capsule":
        return RAPIER.ColliderDesc.capsule(
          this.toMeters(shape.halfHeight),
          this.toMeters(shape.radius),
        );
      case "polygon": {
        const flat = new Float32Array(shape.vertices.length * 2);
        for (let i = 0; i < shape.vertices.length; i++) {
          const v = shape.vertices[i] as { x: number; y: number };
          flat[i * 2] = this.toMeters(v.x);
          flat[i * 2 + 1] = this.toMeters(v.y);
        }
        const desc = RAPIER.ColliderDesc.convexHull(flat);
        if (!desc) {
          throw new Error("Failed to create convex hull from vertices.");
        }
        return desc;
      }
    }
  }
}
