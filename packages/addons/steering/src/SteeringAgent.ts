import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import { Steering } from "./core/Steering.js";
import { clampMagnitude } from "./core/math.js";
import type { SteeringBehavior } from "./core/types.js";

/** Context passed to a custom `apply` callback. */
export interface SteeringApplyContext {
  readonly entity: Entity;
  readonly dt: number;
  readonly transform: Transform;
}

/**
 * A body the agent commands directly and reads back — structural, satisfied
 * by `RigidBodyComponent` without an import. Used by `drive: "velocity"`.
 */
export interface VelocityBody {
  setVelocity(velocity: Vec2Like): void;
  getVelocity(): Vec2Like;
}

/**
 * A body the agent accelerates through the physics solver — structural,
 * satisfied by a dynamic `RigidBodyComponent`. Used by `drive: "impulse"`.
 */
export interface ImpulseBody {
  applyImpulse(impulse: Vec2Like): void;
  getVelocity(): Vec2Like;
  getMass(): number;
}

export interface SteeringAgentOptions {
  /** Top speed in px/s. Settable live via `agent.maxSpeed`. */
  maxSpeed: number;
  /** Behaviors to blend. Mutate `agent.steering` live to add/remove more. */
  behaviors?: SteeringBehavior[];
  /**
   * Acceleration cap in px/s² — the low-pass that keeps steering smooth
   * when the blend changes direction between steps, and what lets
   * knockback and contact impulses persist instead of being cancelled in
   * one write. Default `4 × maxSpeed` (top speed in 0.25 s). Pass
   * `Infinity` for an instant velocity snap.
   */
  maxAcceleration?: number;
  /**
   * The body this agent drives. Behaviors and the acceleration ramp read the
   * body's actual velocity each step, so collisions, knockback, and being
   * pushed off course steer back correctly instead of being computed over.
   * Without a body, the agent integrates the Transform kinematically.
   */
  body?: VelocityBody | ImpulseBody;
  /**
   * How the commanded velocity reaches the body. `"velocity"` (default)
   * writes it (`setVelocity` — full authority, external pushes decay at
   * `maxAcceleration`). `"impulse"` delivers the capped velocity correction
   * through `applyImpulse`, so external impulses compose with steering —
   * use for dynamic bodies that must push and be pushed.
   */
  drive?: "velocity" | "impulse";
  /**
   * Custom output for agents without a body: receives the commanded velocity
   * on each fixed step instead of the default kinematic Transform
   * integration. Mutually exclusive with `body`.
   */
  apply?: (velocity: Vec2, ctx: SteeringApplyContext) => void;
  /**
   * Rotate the Transform to face the travel direction. Default false. On a
   * dynamic `RigidBodyComponent` the simulated rotation owns the Transform,
   * so the body needs `syncRotation: false` for the heading to hold.
   */
  faceHeading?: boolean;
  /** Ticks while true; pause without removing the component. Default true. */
  enabled?: boolean;
}

function defaultKinematicApply(velocity: Vec2, ctx: SteeringApplyContext): void {
  ctx.transform.translate(velocity.x * ctx.dt, velocity.y * ctx.dt);
}

// Below ~1 px/s the heading is contact jitter, not travel — don't rotate.
const FACE_HEADING_MIN_SPEED_SQ = 1;

/**
 * L2a Component hosting a `Steering` model. `ComponentFixedUpdateSystem`
 * drives `fixedUpdate(dt)`, so the agent steers once per fixed step.
 *
 * Assumes the entity is root-level: the default kinematic apply integrates
 * `transform.position` (local), so local == world only without a parent.
 */
export class SteeringAgent extends Component {
  /** Top speed in px/s. */
  maxSpeed: number;
  /** Acceleration cap in px/s². `Infinity` snaps the velocity to the desired value. */
  maxAcceleration: number;
  /** Rotate the Transform to face the travel direction each step. */
  faceHeading: boolean;
  /** The hosted blend model — mutate live (`add`/`remove`/`clear`) to retune behavior. */
  readonly steering: Steering;

  /** Late-bound by integration subclasses that resolve the body from a sibling. */
  protected body: VelocityBody | ImpulseBody | undefined;

  // Not readonly: integration subclasses reconfigure drive in onAdd(), once
  // the sibling body's type is known.
  protected drive: "velocity" | "impulse";
  private readonly applyFn: (velocity: Vec2, ctx: SteeringApplyContext) => void;
  private readonly transform = this.sibling(Transform);
  private _velocity: Vec2 = Vec2.ZERO;

  constructor(options: SteeringAgentOptions) {
    super();
    this.maxSpeed = options.maxSpeed;
    this.maxAcceleration = options.maxAcceleration ?? options.maxSpeed * 4;
    this.faceHeading = options.faceHeading ?? false;
    this.enabled = options.enabled ?? true;
    this.steering = new Steering(options.behaviors ?? []);
    this.body = options.body;
    this.drive = options.drive ?? "velocity";
    if (options.body && options.apply) {
      throw new Error("SteeringAgent: pass `body` or `apply`, not both");
    }
    this.applyFn = options.apply ?? defaultKinematicApply;
  }

  /**
   * The velocity steering is producing — commanded (velocity drive) or
   * expected after this step's impulse (impulse drive). Read for debug
   * drawing; with a body, the body's `getVelocity()` is the ground truth.
   */
  get velocity(): Vec2 {
    return this._velocity;
  }

  /** Replace the behavior list wholesale. */
  setBehaviors(behaviors: SteeringBehavior[]): void {
    this.steering.behaviors = behaviors;
  }

  /** Halt now: zero the bookkeeping and push a zero through the output path. */
  stop(): void {
    this._velocity = Vec2.ZERO;
    const body = this.body;
    if (!body) {
      this.applyFn(Vec2.ZERO, { entity: this.entity, dt: 0, transform: this.transform });
      return;
    }
    if (this.drive === "impulse") {
      const impulseBody = body as ImpulseBody;
      const v = impulseBody.getVelocity();
      const mass = impulseBody.getMass();
      impulseBody.applyImpulse({ x: -v.x * mass, y: -v.y * mass });
      return;
    }
    (body as VelocityBody).setVelocity(Vec2.ZERO);
  }

  fixedUpdate(dt: number): void {
    this.step(dt);
  }

  private step(dt: number): void {
    if (!this.enabled) return;

    const body = this.body;
    let current = this._velocity;
    if (body) {
      const v = body.getVelocity();
      current = new Vec2(v.x, v.y);
    }

    const desired = this.steering.compute(
      {
        position: this.transform.position,
        velocity: current,
        maxSpeed: this.maxSpeed,
        entity: this.entity,
      },
      dt,
    );

    if (this.drive === "impulse") {
      const impulseBody = body as ImpulseBody | undefined;
      if (!impulseBody || typeof impulseBody.applyImpulse !== "function") {
        throw new Error(
          "SteeringAgent: impulse drive requires a `body` with `applyImpulse()`/`getMass()` (e.g. a dynamic RigidBodyComponent)",
        );
      }
      const dv = clampMagnitude(desired.sub(current), this.maxAcceleration * dt);
      impulseBody.applyImpulse(dv.scale(impulseBody.getMass()));
      this._velocity = current.add(dv);
    } else {
      this._velocity = Vec2.moveTowards(current, desired, this.maxAcceleration * dt);
      if (body) {
        (body as VelocityBody).setVelocity(this._velocity);
      } else {
        this.applyFn(this._velocity, { entity: this.entity, dt, transform: this.transform });
      }
    }

    if (this.faceHeading && this._velocity.lengthSq() > FACE_HEADING_MIN_SPEED_SQ) {
      this.transform.setRotation(this._velocity.angle());
    }
  }
}
