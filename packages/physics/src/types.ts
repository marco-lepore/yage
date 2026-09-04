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
 * resolve it for cross-scene inspection and debugging.
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
  /** Gravity in pixels/s², both components finite. Default: { x: 0, y: 980 }. */
  gravity?: { x: number; y: number };
  /** Pixels per meter for internal conversion; finite and > 0. Default: 50. */
  pixelsPerMeter?: number;
}

/** Configuration for creating a rigid body. */
export interface RigidBodyConfig {
  /**
   * Body type: dynamic, static, or kinematic. `RigidBodyComponent.setType`
   * changes it at runtime.
   */
  type: BodyType;
  /** Linear damping coefficient; finite and >= 0. */
  linearDamping?: number;
  /** Angular damping coefficient; finite and >= 0. */
  angularDamping?: number;
  /** If true, body cannot rotate. */
  fixedRotation?: boolean;
  /** Gravity multiplier for this body; finite (negative floats the body up). */
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
 * restLength, pushes apart when compressed below it. Every number is finite;
 * `restLength`, `stiffness` and `damping` are >= 0. */
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

/** Inextensible tether that keeps the anchor points within length. Every
 * number is finite; `length` is >= 0. */
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

/**
 * Which colliders a spatial query reports: `"exclude"` skips sensors and
 * reports solid colliders only (the default — a ground check or line of
 * sight means surfaces, and a trigger zone is not one), `"include"` reports
 * both, `"only"` reports sensors only.
 */
export type QuerySensorMode = "exclude" | "include" | "only";

/**
 * Discriminated union for collider shapes. All dimensions in pixels. Every
 * entry that takes a shape (`ColliderComponent`, `setShape`, `castShape`,
 * `queryShape`, `queryRadius`) throws on a dimension that is not finite and
 * above 0, naming the field.
 */
export type ColliderShape =
  | {
      type: "box";
      /** Finite and > 0. */
      width: number;
      /** Finite and > 0. */
      height: number;
      /**
       * Rounds the corners by this many pixels. The inner half-extents shrink
       * by the radius, so the outer footprint stays `width` × `height` and a
       * resting body keeps its height.
       *
       * The flat part of each face shrinks to `width - 2 * borderRadius`, so
       * a body supported only by the last `borderRadius` pixels of a ledge
       * slides off it.
       *
       * Mass is the rounded footprint's area at the configured `density`,
       * so rounding changes it only by the four corner pieces. Angular
       * inertia is the inner rectangle's, scaled by the same area ratio —
       * an approximation of the exact round-rectangle inertia.
       *
       * Finite, >= 0 and smaller than half the shorter side; anything else
       * throws. Applies to shape casts and overlap queries too.
       */
      borderRadius?: number;
    }
  | {
      type: "circle";
      /** Finite and > 0. */
      radius: number;
    }
  | {
      type: "capsule";
      /**
       * Half the straight section, finite and >= 0. Each cap adds `radius`,
       * so the collider is `2 * (halfHeight + radius)` tall:
       * `{ halfHeight: 20, radius: 10 }` stands 60 px. `0` is a circle.
       */
      halfHeight: number;
      /** Cap radius, finite and > 0. */
      radius: number;
      /** Orientation of the long axis. Default: `"y"` (vertical). */
      axis?: "x" | "y";
    }
  /**
   * Closed convex shape: at least 3 vertices, every coordinate finite, not
   * all on one line. Rapier silently widens concave input to its convex
   * hull; use `polyline` for non-convex outlines.
   */
  | { type: "polygon"; vertices: Vec2Like[] }
  /**
   * Chain of line segments: at least 2 vertices, every coordinate finite.
   * Supports non-convex shapes but is static-only (no mass/inertia
   * computed). Best for world boundaries.
   */
  | { type: "polyline"; vertices: Vec2Like[] };

/** Configuration for a one-way platform collider. */
export interface OneWayConfig {
  /**
   * Direction the solid side faces, in the platform body's local frame.
   * Any non-zero vector with finite components, normalized internally; a
   * zero vector throws when the component is constructed. Default:
   * `{ x: 0, y: -1 }` — the solid side faces up, so bodies land from above
   * and pass through from below.
   */
  direction?: Vec2Like;
  /**
   * How deep (in pixels) a body may already overlap the solid face and
   * still land on it. Below that, the body counts as inside the platform
   * and passes through. Finite. Default: 4.
   */
  margin?: number;
}

/** Geometry and body-local placement for one collider part. */
export interface ColliderPartConfig {
  /** Shape of the collider. */
  shape: ColliderShape;
  /** Offset from body center in pixels. */
  offset?: { x: number; y: number };
  /**
   * Rotation relative to the body in radians, about the collider's offset
   * point. For `axis: "x"` capsules it adds on top of the 90° axis rotation.
   */
  rotation?: number;
}

/** Settings shared by every part of a collider component. */
interface ColliderSharedConfig {
  /** Coefficient of restitution (bounciness); finite and >= 0. */
  restitution?: number;
  /** Friction coefficient; finite and >= 0. */
  friction?: number;
  /** Density (affects mass for dynamic bodies); finite and >= 0. Default: 1. */
  density?: number;
  /**
   * Keeps this collider this many pixels away from anything it touches, so a
   * resting body sits that far above the surface. Two colliders that both set
   * a skin are held apart by the sum of the two. Finite and >= 0.
   *
   * Contacts only — shape casts and overlap queries ignore it.
   */
  contactSkin?: number;
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

/** Configuration for creating one collider or several parts on one body. */
export type ColliderConfig = ColliderSharedConfig &
  (
    | (ColliderPartConfig & { parts?: never })
    | {
        /** Ordered collider parts attached to the same rigid body. */
        parts: ColliderPartConfig[];
        shape?: never;
        offset?: never;
        rotation?: never;
      }
  );

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
  /** Index of this participating shape in its collider component. */
  readonly selfShapeIndex: number;
  /** Index of the other participating shape in its collider component. */
  readonly otherShapeIndex: number;
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
 * pair have filters, both run for every candidate pair and the pair is
 * solid only if both return `true`.
 */
export type ContactFilter = (contact: ContactCandidate) => boolean;

/** Collision event data passed to collision handlers. */
export interface CollisionEvent {
  /** The other entity involved in the collision. */
  other: Entity;
  /** The other entity's collider component. */
  otherCollider: ColliderComponent;
  /** Index of this participating shape in its collider component. */
  selfShapeIndex: number;
  /** Index of the other participating shape in its collider component. */
  otherShapeIndex: number;
  /** True if the collision just started, false if it ended. */
  started: boolean;
  /**
   * Unit vector pointing from this entity toward the other, in world space,
   * for the pair's deepest contact. Two colliders can touch along several
   * surfaces at once, and this is the surface pushing hardest. Only on
   * started, non-sensor collisions; may be absent if no contact manifold is
   * available (e.g. same-step start+stop).
   */
  contactNormal?: Vec2;
  /**
   * The world-pixel point of the pair's deepest contact, not an average. A
   * resting box touches at several points at once; when they are equally
   * deep, any one of them can be reported. Only on started, non-sensor
   * collisions; may be absent if no contact manifold is available.
   */
  contactPoint?: Vec2;
  /**
   * Penetration depth of the pair's deepest contact in pixels, clamped to >=
   * 0. Only on started, non-sensor collisions; may be absent if no contact
   * manifold is available.
   */
  penetrationDepth?: number;
  /**
   * Magnitude of the total impulse the solver applied to resolve the
   * contact during the step, in the same units `applyImpulse` takes;
   * friction is not included. Dividing by a dynamic body's `getMass()`
   * gives the speed change that body received from the contact, in px/s
   * (a static or kinematic body receives the event too, but no velocity
   * change). Only
   * on started, non-sensor collisions with a contact manifold available;
   * may be 0 when the solver did not need to apply an impulse (e.g. a
   * grazing contact).
   */
  contactImpulse?: number;
  /**
   * The contact impulse as a vector, oriented from this entity toward the
   * other like `contactNormal`; its length equals `contactImpulse`. The
   * push on this body points the opposite way: for a dynamic body,
   * `contactImpulseVector.scale(-1 / getMass())` is its velocity change in
   * px/s. Present exactly when `contactImpulse` is.
   */
  contactImpulseVector?: Vec2;
}

/** Trigger event data passed to trigger handlers. */
export interface TriggerEvent {
  /** The other entity involved in the trigger. */
  other: Entity;
  /** The other entity's collider component. */
  otherCollider: ColliderComponent;
  /** Index of this participating shape in its collider component. */
  selfShapeIndex: number;
  /** Index of the other participating shape in its collider component. */
  otherShapeIndex: number;
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
