import { ServiceKey } from "@yage/core";
import type { Entity, Vec2Like } from "@yage/core";
import type { Vec2 } from "@yage/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import type { ColliderComponent } from "./ColliderComponent.js";

/** Service key for the PhysicsWorld instance. */
export const PhysicsWorldKey = new ServiceKey<PhysicsWorld>("physicsWorld");

/** Shared ref for physics interpolation alpha, updated by PhysicsSystem. */
export interface PhysicsAlphaRef {
  value: number;
}

/** Service key for the physics interpolation alpha ref. */
export const PhysicsInterpolationAlphaKey =
  new ServiceKey<PhysicsAlphaRef>("physicsInterpolationAlpha");

/** Body type for rigid bodies. */
export type BodyType = "dynamic" | "static" | "kinematic";

/** Configuration for the physics world. */
export interface PhysicsConfig {
  /** Gravity in pixels/s². Default: { x: 0, y: 980 }. */
  gravity?: { x: number; y: number };
  /** Pixels per meter for internal conversion. Default: 50. */
  pixelsPerMeter?: number;
}

/** Configuration for creating a rigid body. */
export interface RigidBodyConfig {
  /** Body type: dynamic, static, or kinematic. */
  type: BodyType;
  /** Linear damping coefficient. */
  linearDamping?: number;
  /** Angular damping coefficient. */
  angularDamping?: number;
  /** If true, body cannot rotate. */
  fixedRotation?: boolean;
  /** Gravity multiplier for this body. */
  gravityScale?: number;
  /** Enable continuous collision detection. */
  ccd?: boolean;
  /** If true, disable translation on the X axis. */
  lockTranslationX?: boolean;
  /** If true, disable translation on the Y axis. */
  lockTranslationY?: boolean;
  /** If false, physics will not write rotation back to Transform. Default: true. */
  syncRotation?: boolean;
}

/** Discriminated union for collider shapes. All dimensions in pixels. */
export type ColliderShape =
  | { type: "box"; width: number; height: number }
  | { type: "circle"; radius: number }
  | { type: "capsule"; halfHeight: number; radius: number }
  | { type: "polygon"; vertices: Vec2Like[] };

/** Configuration for creating a collider. */
export interface ColliderConfig {
  /** Shape of the collider. */
  shape: ColliderShape;
  /** Offset from body center in pixels. */
  offset?: { x: number; y: number };
  /** Coefficient of restitution (bounciness). */
  restitution?: number;
  /** Friction coefficient. */
  friction?: number;
  /** Density (affects mass for dynamic bodies). */
  density?: number;
  /** If true, this is a sensor (triggers events but no physical response). */
  sensor?: boolean;
  /** Collision layer membership bitmask. */
  layers?: number;
  /** Collision filter mask (which layers to interact with). */
  mask?: number;
}

/** Collision event data passed to collision handlers. */
export interface CollisionEvent {
  /** The other entity involved in the collision. */
  other: Entity;
  /** The other entity's collider component. */
  otherCollider: ColliderComponent;
  /** True if the collision just started, false if it ended. */
  started: boolean;
  /** Contact normal (only for started collisions). */
  contactNormal?: Vec2;
  /** Contact point in world pixels (only for started collisions). */
  contactPoint?: Vec2;
}

/** Trigger event data passed to trigger handlers. */
export interface TriggerEvent {
  /** The other entity involved in the trigger. */
  other: Entity;
  /** The other entity's collider component. */
  otherCollider: ColliderComponent;
  /** True if entering the trigger, false if leaving. */
  entered: boolean;
}

/** Result of a raycast query. */
export interface RaycastHit {
  /** The entity that was hit. */
  entity: Entity;
  /** Hit point in world pixels. */
  point: Vec2;
  /** Surface normal at the hit point. */
  normal: Vec2;
  /** Distance from ray origin in pixels. */
  distance: number;
}
