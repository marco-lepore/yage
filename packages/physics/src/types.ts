import { ServiceKey } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import type { Vec2 } from "@yagejs/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import type { ColliderComponent } from "./ColliderComponent.js";

/** Mutable ref holding the interpolation alpha for a single scene's physics. */
export interface PhysicsAlphaRef {
  value: number;
}

/** Per-scene physics state: world instance, sub-accumulator, and interpolation alpha. */
export interface ScenePhysicsContext {
  world: PhysicsWorld;
  accumulator: number;
  alphaRef: PhysicsAlphaRef;
}

/**
 * Engine-scope key for the PhysicsWorldManager. Owns all per-scene worlds;
 * resolve it for cross-scene enumeration (save system, debug inspector).
 */
export const PhysicsWorldManagerKey = new ServiceKey<PhysicsWorldManager>(
  "physicsWorldManager",
);

/**
 * Scene-scope key for the active scene's `PhysicsWorld`. Registered by the
 * physics plugin's `beforeEnter` hook; components resolve via
 * `this.use(PhysicsWorldKey)`.
 */
export const PhysicsWorldKey = new ServiceKey<PhysicsWorld>("physicsWorld", {
  scope: "scene",
});

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

/** Elastic connection between two bodies. Pulls together when stretched past
 * restLength, pushes apart when compressed below it. */
export interface SpringJointConfig {
  type: "spring";
  /** Distance the spring tries to hold, in pixels. */
  restLength: number;
  /**
   * Spring strength, mass-relative: a body of mass m stretched by d pixels
   * accelerates at stiffness * d / m px/s². Passed to the solver unconverted,
   * and collider mass depends on pixelsPerMeter (density × area in meters) —
   * retune after changing the scale.
   */
  stiffness: number;
  /** Resists relative motion along the spring axis. Same mass-relative units as stiffness. */
  damping: number;
  /** Attachment point on body A in pixels, local to the body. Default: body origin. */
  anchorA?: Vec2Like;
  /** Attachment point on body B in pixels, local to the body. Default: body origin. */
  anchorB?: Vec2Like;
}

/** Inextensible tether that keeps the anchor points within length. */
export interface RopeJointConfig {
  type: "rope";
  /** Maximum distance between the anchor points, in pixels. */
  length: number;
  /** Attachment point on body A in pixels, local to the body. Default: body origin. */
  anchorA?: Vec2Like;
  /** Attachment point on body B in pixels, local to the body. Default: body origin. */
  anchorB?: Vec2Like;
}

export type JointConfig = SpringJointConfig | RopeJointConfig;

/** Live joint created by `PhysicsWorld.addJoint`. */
export interface JointHandle {
  /** True while the joint exists in the simulation. Becomes false after remove(), or when either jointed body is disabled or removed. */
  readonly attached: boolean;
  /** Detach and free the joint. Safe to call more than once. */
  remove(): void;
}

/** Discriminated union for collider shapes. All dimensions in pixels. */
export type ColliderShape =
  | { type: "box"; width: number; height: number }
  | { type: "circle"; radius: number }
  | {
      type: "capsule";
      halfHeight: number;
      radius: number;
      /** Orientation of the long axis. Default: `"y"` (vertical). */
      axis?: "x" | "y";
    }
  /**
   * Closed convex shape. Rapier silently widens concave input to its convex
   * hull; use `polyline` for non-convex outlines.
   */
  | { type: "polygon"; vertices: Vec2Like[] }
  /**
   * Chain of line segments. Supports non-convex shapes but is static-only
   * (no mass/inertia computed). Best for world boundaries.
   */
  | { type: "polyline"; vertices: Vec2Like[] };

/** Configuration for a one-way platform collider. */
export interface OneWayConfig {
  /**
   * Direction the solid side faces, in the platform body's local frame.
   * Any non-zero vector; normalized internally. Default: `{ x: 0, y: -1 }` —
   * the solid side faces up, so bodies land from above and pass through
   * from below.
   */
  direction?: Vec2Like;
  /**
   * How deep (in pixels) a body may already overlap the solid face and
   * still land on it. Below that, the body counts as inside the platform
   * and passes through. Default: 4.
   */
  margin?: number;
}

/** Configuration for creating a collider. */
export interface ColliderConfig {
  /** Shape of the collider. */
  shape: ColliderShape;
  /** Offset from body center in pixels. */
  offset?: { x: number; y: number };
  /**
   * Rotation relative to the body in radians, about the collider's offset
   * point. For `axis: "x"` capsules it adds on top of the 90° axis rotation.
   */
  rotation?: number;
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
  /**
   * Make this collider a one-way platform: solid for bodies arriving from
   * the side `direction` faces, passable from every other side. Installs a
   * built-in contact filter on the collider.
   */
  oneWay?: OneWayConfig;
}

/**
 * A candidate contact pair, seen from one collider's side, before any
 * contact exists. Passed to a `ContactFilter` — no contact normal or
 * contact point is available at this stage, only positions and velocities.
 *
 * All values are from the start of the physics step being computed, before
 * this step's movement is applied — for a body that crossed a surface
 * mid-step, they tell you which side it came from.
 *
 * The same object instance is reused for every filter call; read what you
 * need inside the filter and do not hold a reference to it.
 */
export interface ContactCandidate {
  /** The other entity in the candidate pair. */
  readonly other: Entity;
  /** The other entity's collider component. */
  readonly otherCollider: ColliderComponent;
  /** Duration of the physics step being computed, in seconds. */
  readonly dt: number;
  /** Own collider's world X position in pixels. */
  readonly selfX: number;
  /** Own collider's world Y position in pixels. */
  readonly selfY: number;
  /** Own collider's world rotation in radians. */
  readonly selfRotation: number;
  /** Own body's X velocity in pixels/s. */
  readonly selfVelocityX: number;
  /** Own body's Y velocity in pixels/s. */
  readonly selfVelocityY: number;
  /** Other collider's world X position in pixels. */
  readonly otherX: number;
  /** Other collider's world Y position in pixels. */
  readonly otherY: number;
  /** Other collider's world rotation in radians. */
  readonly otherRotation: number;
  /** Other body's X velocity in pixels/s. */
  readonly otherVelocityX: number;
  /** Other body's Y velocity in pixels/s. */
  readonly otherVelocityY: number;
}

/**
 * Decides whether a candidate contact pair is solid for the current physics
 * step. Return `true` to collide normally, `false` to let the two colliders
 * pass through each other this step.
 *
 * Runs inside the physics step for every candidate pair involving the
 * collider, every step — keep it cheap and do not create or destroy
 * entities, bodies, or colliders from inside it. When both colliders in a
 * pair have filters, the pair is solid only if both return `true`.
 */
export type ContactFilter = (contact: ContactCandidate) => boolean;

/** Collision event data passed to collision handlers. */
export interface CollisionEvent {
  /** The other entity involved in the collision. */
  other: Entity;
  /** The other entity's collider component. */
  otherCollider: ColliderComponent;
  /** True if the collision just started, false if it ended. */
  started: boolean;
  /**
   * Unit vector pointing from this entity toward the other, in world space.
   * Only on started, non-sensor collisions; may be absent if no contact
   * manifold is available (e.g. same-step start+stop).
   */
  contactNormal?: Vec2;
  /**
   * A representative contact point in world pixels (a resting box has two;
   * this is the first, not an average). Only on started, non-sensor
   * collisions; may be absent if no contact manifold is available.
   */
  contactPoint?: Vec2;
  /**
   * Penetration depth in pixels, clamped to >= 0. Only on started,
   * non-sensor collisions; may be absent if no contact manifold is
   * available.
   */
  penetrationDepth?: number;
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
