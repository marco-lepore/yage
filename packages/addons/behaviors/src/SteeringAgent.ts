import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { Steering } from "./core/Steering.js";
import type { SteeringBehavior } from "./core/types.js";

/** Context passed to a custom `apply` callback. */
export interface SteeringApplyContext {
  readonly entity: Entity;
  readonly dt: number;
  readonly transform: Transform;
}

export interface SteeringAgentOptions {
  /** Top speed in px/s. Settable live via `agent.maxSpeed`. */
  maxSpeed: number;
  /** Behaviors to blend. Mutate `agent.steering` live to add/remove more. */
  behaviors?: SteeringBehavior[];
  /** Turn-rate cap in px/s². Omit for an instant velocity change. */
  maxAcceleration?: number;
  /**
   * How the commanded velocity is applied each frame. Defaults to kinematic
   * Transform integration (`transform.translate(v.x * dt, v.y * dt)`) — pass
   * a callback to drive a physics body instead, e.g.
   * `(v) => body.setVelocity(v)`. The addon never imports `@yagejs/physics`.
   */
  apply?: (velocity: Vec2, ctx: SteeringApplyContext) => void;
  /** Rotate the Transform to face the travel direction. Default false. */
  faceHeading?: boolean;
  /** Ticks while true; pause without removing the component. Default true. */
  enabled?: boolean;
}

function defaultKinematicApply(velocity: Vec2, ctx: SteeringApplyContext): void {
  ctx.transform.translate(velocity.x * ctx.dt, velocity.y * ctx.dt);
}

/**
 * L2a Component hosting a `Steering` model, driven by `ComponentUpdateSystem`.
 *
 * Assumes the entity is root-level: the default kinematic apply integrates
 * `transform.position` (local), so local == world only without a parent.
 */
export class SteeringAgent extends Component {
  /** Top speed in px/s. */
  maxSpeed: number;
  /** Turn-rate cap in px/s². `undefined` means the velocity snaps to the desired value. */
  maxAcceleration: number | undefined;
  /** Rotate the Transform to face the travel direction each frame. */
  faceHeading: boolean;
  /** The hosted blend model — mutate live (`add`/`remove`/`clear`) to retune behavior. */
  readonly steering: Steering;

  private readonly applyFn: (velocity: Vec2, ctx: SteeringApplyContext) => void;
  private readonly transform = this.sibling(Transform);
  private _velocity: Vec2 = Vec2.ZERO;

  constructor(options: SteeringAgentOptions) {
    super();
    this.maxSpeed = options.maxSpeed;
    this.maxAcceleration = options.maxAcceleration;
    this.faceHeading = options.faceHeading ?? false;
    this.enabled = options.enabled ?? true;
    this.steering = new Steering(options.behaviors ?? []);
    this.applyFn = options.apply ?? defaultKinematicApply;
  }

  /** Last commanded velocity — read for debug drawing (e.g. an arrow via `@yagejs/debug`). */
  get velocity(): Vec2 {
    return this._velocity;
  }

  /** Replace the behavior list wholesale. */
  setBehaviors(behaviors: SteeringBehavior[]): void {
    this.steering.behaviors = behaviors;
  }

  /** Zero the commanded velocity immediately. */
  stop(): void {
    this._velocity = Vec2.ZERO;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    const desired = this.steering.compute(
      {
        position: this.transform.position,
        velocity: this._velocity,
        maxSpeed: this.maxSpeed,
      },
      dt,
    );

    this._velocity =
      this.maxAcceleration !== undefined
        ? Vec2.moveTowards(this._velocity, desired, this.maxAcceleration * dt)
        : desired;

    this.applyFn(this._velocity, { entity: this.entity, dt, transform: this.transform });

    if (this.faceHeading && this._velocity.lengthSq() > 0) {
      this.transform.setRotation(this._velocity.angle());
    }
  }
}
